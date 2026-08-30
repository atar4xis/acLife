import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/context/ApiContext";
import { useEffect, useState } from "react";

const RESEND_COOLDOWN_SECONDS = 60;

export function EmailVerificationRequired({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const { post } = useApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await post("auth/resend-verification", { email });

      if (res.success) {
        setSuccess("Verification email sent.");
      } else {
        setError(res.message || "Failed to resend verification email.");
      }

      setCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-center">
      <Card className="bg-transparent border-none shadow-none">
        <CardTitle>Email verification required</CardTitle>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm mb-4">
            A verification link has been sent to <strong>{email}</strong>.
          </p>
          <Button onClick={handleResend} disabled={loading || cooldown > 0}>
            {loading ? (
              <Spinner />
            ) : cooldown > 0 ? (
              `Resend email (${cooldown}s)`
            ) : (
              "Resend email"
            )}
          </Button>
          {error && (
            <span className="text-sm text-red-700 dark:text-red-400">
              {error}
            </span>
          )}
          {success && !error && (
            <span className="text-sm text-green-700 dark:text-green-400">
              {success}
            </span>
          )}
          <Button variant="outline" onClick={onBack}>
            Back to login
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
