import { toast } from "sonner";
import { Client } from "@mzattahri/srp";
import type { Params } from "@mzattahri/srp";
import type { APIResponse } from "@/types/API";
import type { ApiPost } from "@/lib/calendar/crypt";
import {
  generateSRPTriplet,
  LEGACY_SRP_PARAMS,
  SRP_CheckM2,
  SRP_PARAMS,
  type KeyEnvelope,
} from "@/lib/crypt";
import { bytesToBase64, uint8ArrayFromBase64 } from "@/lib/utils";
import { t } from "@/i18n";

type Attempt = { ok: true } | { ok: false; message: string; code?: string };

export type SrpLoginResult =
  | { success: true; legacy: boolean; salt: Uint8Array }
  | { success: false; message: string };

const failure = (res: APIResponse<unknown>): Attempt => ({
  ok: false,
  message: res.message || t("common.unknownError"),
  code: res.code,
});

async function attemptLogin(
  post: ApiPost,
  email: string,
  password: string,
  salt: Uint8Array,
  params: Params,
): Promise<Attempt> {
  const client = await Client.initialize(params, email, password, salt);

  const res1 = await post<{ B: string; session_id: string }>(
    "auth/login/start",
    { email, A: bytesToBase64(client.A) },
  );
  if (!res1.success || !res1.data) return failure(res1);

  await client.setB(uint8ArrayFromBase64(res1.data.B));

  const res2 = await post<{ M2: string }>("auth/login/verify", {
    email,
    M1: bytesToBase64(client.M1),
    session_id: res1.data.session_id,
  });
  if (!res2.success || !res2.data) return failure(res2);

  // workaround for SRP_CheckM2 bug
  // eslint-disable-next-line
  const M2 = (client as any).M2;
  const M2Received = uint8ArrayFromBase64(res2.data.M2);
  if (!SRP_CheckM2(M2, M2Received, params.group.bitLength)) {
    return { ok: false, message: t("login.integrityFailed") };
  }

  return { ok: true };
}

// temporary migration
export async function srpLogin(
  post: ApiPost,
  email: string,
  password: string,
): Promise<SrpLoginResult> {
  const saltRes = await post<string>("auth/login/start", { email });
  if (!saltRes.success || !saltRes.data) {
    return {
      success: false,
      message: saltRes.message || t("common.unknownError"),
    };
  }
  const salt = uint8ArrayFromBase64(saltRes.data);

  let attempt = await attemptLogin(post, email, password, salt, SRP_PARAMS);
  let legacy = false;
  if (!attempt.ok && attempt.code === "invalid_credentials") {
    legacy = true;
    attempt = await attemptLogin(
      post,
      email,
      password,
      salt,
      LEGACY_SRP_PARAMS,
    );
  }

  return attempt.ok
    ? { success: true, legacy, salt }
    : { success: false, message: attempt.message };
}

// temporary migration
export async function upgradeSrpKdf(
  post: ApiPost,
  user: { email: string; envelopes: KeyEnvelope[] },
  password: string,
  salt: Uint8Array,
) {
  if (user.envelopes.length === 0) return;

  const [current, next] = await Promise.all([
    generateSRPTriplet(user.email, password, salt, LEGACY_SRP_PARAMS),
    generateSRPTriplet(user.email, password),
  ]);

  const res = await post("user/password", {
    current_triplet: bytesToBase64(current.toUint8Array()),
    triplet: bytesToBase64(next.toUint8Array()),
    envelopes: user.envelopes,
  });
  if (res.success) toast.success(t("unlock.upgraded"));
  else console.error("SRP upgrade failed:", res.message);
}

// temporary migration
export async function postWithCurrentTriplet<T>(
  post: ApiPost,
  email: string,
  currentPassword: string,
  currentSalt: Uint8Array,
  endpoint: string,
  body: Record<string, unknown>,
) {
  const attempt = async (params: Params) => {
    const current = await generateSRPTriplet(
      email,
      currentPassword,
      currentSalt,
      params,
    );
    return post<T>(endpoint, {
      ...body,
      current_triplet: bytesToBase64(current.toUint8Array()),
    });
  };

  const res = await attempt(SRP_PARAMS);
  return res.code === "current_password_incorrect"
    ? attempt(LEGACY_SRP_PARAMS)
    : res;
}
