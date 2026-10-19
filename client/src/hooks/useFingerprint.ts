import { fingerprint } from "@/lib/shareCrypto";
import { useEffect, useState } from "react";

export function useFingerprint(publicKey: string) {
  const [code, setCode] = useState("");

  useEffect(() => {
    let current = true;
    fingerprint(publicKey).then((value) => current && setCode(value));
    return () => {
      current = false;
    };
  }, [publicKey]);

  return code;
}
