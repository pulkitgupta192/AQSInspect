export {};

declare global {
  interface Window {
    api: {
      ping: () => Promise<string>;
      getAppInfo: () => Promise<{
        appName: string;
        version: string;
        platform: string;
      }>;
      fetchPullRequestDiff: (
        prUrl: string
      ) => Promise<any>;
    };
  }
}
