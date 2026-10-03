export interface APIResponse<T> {
  success: boolean;
  message?: string;
  code?: string;
  params?: Record<string, unknown>;
  data?: T;
}

export type APIConfig = {
  url: string;
};
