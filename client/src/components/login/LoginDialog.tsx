import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoginForm } from "@/components/login/LoginForm";
import { ModeToggle } from "@/components/ModeToggle";
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CheckIcon } from "lucide-react";
import { FieldDescription } from "@/components/ui/field";
import { domainName, joinUrl } from "@/lib/utils";
import { validateServerMeta } from "@/lib/validators";
import { useApi } from "@/context/ApiContext";

export default function LoginDialog() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    "success" | "failure" | "invalid" | null
  >(null);
  const [serverSwitcherOpen, setServerSwitcherOpen] = useState(false);
  const [pendingServerURL, setPendingServerURL] = useState<string>("");
  const { setUrl, serverMeta } = useApi();

  useEffect(() => {
    const savedServerURL =
      localStorage.getItem("serverURL") || "https://ataraxis.codes/acLife/api/";

    setPendingServerURL(savedServerURL);
    setUrl(savedServerURL);
  }, [setUrl]);

  const handleServerURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPendingServerURL(e.target.value || "");
    setTestResult(null);
    setTesting(false);
  };

  const testServerConnection = async () => {
    const url = pendingServerURL;

    setTesting(true);
    setTestResult(null);

    try {
      const req = await fetch(joinUrl(url, "/metadata"));
      const res = await req.json();

      if (url !== pendingServerURL) return;

      if (!validateServerMeta(res.data)) throw new Error("invalid meta");

      setTestResult("success");
    } catch (e) {
      if (url !== pendingServerURL) return;

      if (e instanceof Error && e.message.includes("invalid")) {
        setTestResult("invalid");
      } else {
        setTestResult("failure");
      }
    } finally {
      if (url === pendingServerURL) setTesting(false);
    }
  };

  const handleSaveServerURL = () => {
    if (testResult !== "success") return;

    localStorage.setItem("serverURL", pendingServerURL);

    setServerSwitcherOpen(false);
    setTesting(false);
    setTestResult(null);

    setUrl(pendingServerURL);
  };

  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        {serverSwitcherOpen ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-center">Change server</DialogTitle>
            </DialogHeader>
            <div className="mt-3 gap-3 grid">
              <Label htmlFor="server">Server URL</Label>
              <div className="flex w-full items-center gap-2">
                <Input
                  id="server"
                  type="url"
                  value={pendingServerURL}
                  placeholder="https://ataraxis.codes/"
                  required
                  onChange={handleServerURLChange}
                  disabled={testing}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="p-1"
                      onClick={testServerConnection}
                      disabled={!pendingServerURL || testing}
                      variant="outline"
                      size="icon"
                      type="button"
                    >
                      {testing ? <Spinner /> : <CheckIcon />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Test Connectivity</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <FieldDescription>
                {testResult === "success" && (
                  <span className="text-green-700 dark:text-green-400">
                    Connection successful. Save to apply changes.
                  </span>
                )}
                {testResult === "failure" && (
                  <span className="text-red-700 dark:text-red-400">
                    Connection failed. Please try again.
                  </span>
                )}
                {testResult === "invalid" && (
                  <span className="text-orange-700 dark:text-orange-400">
                    Invalid metadata response. Please confirm the URL.
                  </span>
                )}
              </FieldDescription>
            </div>
            <Button
              className="mt-2 w-full"
              disabled={testResult !== "success" || testing}
              onClick={handleSaveServerURL}
            >
              Save changes
            </Button>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => setServerSwitcherOpen(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-center">
                Log in to your account
              </DialogTitle>
              <DialogDescription className="text-center">
                on{" "}
                <span
                  className="border-b border-dashed border-gray-500 hover:border-gray-400 hover:border-solid hover:cursor-pointer"
                  onClick={() => setServerSwitcherOpen(true)}
                >
                  {serverMeta ? domainName(serverMeta.url) : "..."}
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="fixed left-4 top-4">
              <ModeToggle />
            </div>
            {serverMeta && <LoginForm serverMeta={serverMeta} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
