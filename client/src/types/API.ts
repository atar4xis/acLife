export interface APIResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export type APIConfig = {
  url: string;
};
