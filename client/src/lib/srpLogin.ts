import { Client } from "@mzattahri/srp";
import type { APIResponse } from "@/types/API";
import type { ApiPost } from "@/lib/calendar/crypt";
import { SRP_CheckM2, SRP_PARAMS } from "@/lib/crypt";
import { bytesToBase64, uint8ArrayFromBase64 } from "@/lib/utils";
import { t } from "@/i18n";

export type SrpLoginResult =
  { success: true } | { success: false; message: string };

type Started =
  | { ok: true; client: Client; sessionId: string }
  | { ok: false; response: APIResponse<unknown> };

const failure = (res: APIResponse<unknown>) => ({
  success: false as const,
  message: res.message || t("common.unknownError"),
  code: res.code,
  params: res.params,
});

// first SRP step: fetch the salt, then send A to `endpoint` and apply the B it answers with
async function startSrp(
  post: ApiPost,
  endpoint: string,
  fields: Record<string, unknown>,
  email: string,
  password: string,
): Promise<Started> {
  const saltRes = await post<string>("auth/login/start", { email });
  if (!saltRes.success || !saltRes.data)
    return { ok: false, response: saltRes };

  const client = await Client.initialize(
    SRP_PARAMS,
    email,
    password,
    uint8ArrayFromBase64(saltRes.data),
  );

  const res = await post<{ B: string; session_id: string }>(endpoint, {
    ...fields,
    A: bytesToBase64(client.A),
  });
  if (!res.success || !res.data) return { ok: false, response: res };

  await client.setB(uint8ArrayFromBase64(res.data.B));
  return { ok: true, client, sessionId: res.data.session_id };
}

export async function srpLogin(
  post: ApiPost,
  email: string,
  password: string,
): Promise<SrpLoginResult> {
  const started = await startSrp(
    post,
    "auth/login/start",
    { email },
    email,
    password,
  );
  if (!started.ok) return failure(started.response);

  const { client, sessionId } = started;
  const res = await post<{ M2: string }>("auth/login/verify", {
    email,
    M1: bytesToBase64(client.M1),
    session_id: sessionId,
  });
  if (!res.success || !res.data) return failure(res);

  // workaround for SRP_CheckM2 bug
  // eslint-disable-next-line
  const M2 = (client as any).M2;
  const M2Received = uint8ArrayFromBase64(res.data.M2);
  if (!SRP_CheckM2(M2, M2Received, SRP_PARAMS.group.bitLength)) {
    return { success: false, message: t("login.integrityFailed") };
  }

  return { success: true };
}

// proves the current password with a full SRP exchange, the password itself is never sent
export async function postWithPassword<T>(
  post: ApiPost,
  email: string,
  password: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<APIResponse<T>> {
  const started = await startSrp(
    post,
    "user/reauth/start",
    {},
    email,
    password,
  );
  if (!started.ok) return failure(started.response);

  return post<T>(endpoint, {
    ...body,
    M1: bytesToBase64(started.client.M1),
    session_id: started.sessionId,
  });
}
