import { RestEndpointMethodTypes } from "@octokit/rest";

export type ListForOrg = RestEndpointMethodTypes["repos"]["listForOrg"]["response"];
export type ListIssueForRepo = RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"][0];
export type ListCommentsForIssue = RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][0];
export type GitHubListEvents = RestEndpointMethodTypes["issues"]["listEvents"]["response"]["data"][0];
