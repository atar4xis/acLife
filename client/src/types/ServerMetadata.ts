export interface ServerMetadata {
  url: string;
  policies: {
    privacy?: string;
    terms?: string;
  };
  registration: {
    enabled: boolean;
    subscriptionRequired: boolean;
    email?: {
      verificationRequired: boolean;
      domainBlacklist: string[];
    };
    retentionPeriod?: number; // in days
  };
}
