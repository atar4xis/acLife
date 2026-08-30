import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/context/ApiContext";
import { useState } from "react";
import { toast } from "sonner";

export function ConfirmEmailPrompt({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const { post } = useApi();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);

    try {
      const res = await post("auth/verify-email", { token });

      if (res.success) {
        toast.success("Email verified. You can now log in.");
      } else {
        toast.error(
          res.message || "Email verification failed.");
      }
    } finally {
      setLoading(false);
      onDone();
    }
  };

  return (
    <div className="flex flex-col gap-4 text-center">
      <p className="text-sm my-4">
        Click the button below to verify your email address.
      </p>
      <Button onClick={handleConfirm} disabled={loading}>
        {loading ? <Spinner /> : "Verify email"}
      </Button>
      <Button variant="outline" onClick={onDone} disabled={loading}>
        Cancel
      </Button>
    </div>
  );
}
