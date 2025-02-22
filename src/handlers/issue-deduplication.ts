import { IssueSimilaritySearchResult } from "../adapters/supabase/helpers/issues";
import { Context } from "../types";
import { IssuePayload } from "../types/payload";

export interface IssueGraphqlResponse {
  node: {
    title: string;
    url: string;
  };
  similarity: string;
}

/**
 * Check if an issue is similar to any existing issues in the database
 * @param context
 * @returns true if the issue is similar to an existing issue, false otherwise
 */
export async function issueChecker(context: Context): Promise<boolean> {
  const {
    logger,
    adapters: { supabase },
    octokit,
  } = context;
  const { payload } = context as { payload: IssuePayload };
  const issue = payload.issue;
  const issueContent = issue.body + issue.title;

  // Fetch all similar issues based on settings.warningThreshold
  const similarIssues = await supabase.issue.findSimilarIssues(issueContent, context.config.warningThreshold, issue.node_id);
  console.log(similarIssues);
  if (similarIssues && similarIssues.length > 0) {
    const matchIssues = similarIssues.filter((issue) => issue.similarity >= context.config.matchThreshold);

    // Handle issues that match the MATCH_THRESHOLD (Very Similar)
    if (matchIssues.length > 0) {
      logger.info(`Similar issue which matches more than ${context.config.matchThreshold} already exists`);
      await octokit.issues.update({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: issue.number,
        state: "closed",
        state_reason: "not_planned",
      });
    }

    // Handle issues that match the settings.warningThreshold but not the MATCH_THRESHOLD
    if (similarIssues.length > 0) {
      logger.info(`Similar issue which matches more than ${context.config.warningThreshold} already exists`);
      await handleSimilarIssuesComment(context, payload, issue.number, similarIssues);
      return true;
    }
  }

  return false;
}

/**
 * Handle commenting on an issue with similar issues information
 * @param context
 * @param payload
 * @param issueNumber
 * @param similarIssues
 */
async function handleSimilarIssuesComment(context: Context, payload: IssuePayload, issueNumber: number, similarIssues: IssueSimilaritySearchResult[]) {
  const issueList: IssueGraphqlResponse[] = await Promise.all(
    similarIssues.map(async (issue: IssueSimilaritySearchResult) => {
      const issueUrl: IssueGraphqlResponse = await context.octokit.graphql(
        `query($issueNodeId: ID!) {
          node(id: $issueNodeId) {
            ... on Issue {
              title
              url
            }
          }
        }`,
        { issueNodeId: issue.issue_id }
      );
      issueUrl.similarity = (issue.similarity * 100).toFixed(2);
      return issueUrl;
    })
  );

  const commentBody = issueList.map((issue) => `- [${issue.node.title}](${issue.node.url}) Similarity: ${issue.similarity}`).join("\n");
  const body = `This issue seems to be similar to the following issue(s):\n\n${commentBody}`;

  const existingComments = await context.octokit.issues.listComments({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: issueNumber,
  });

  const existingComment = existingComments.data.find(
    (comment) => comment.body && comment.body.includes("This issue seems to be similar to the following issue(s)")
  );

  if (existingComment) {
    await context.octokit.issues.updateComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      comment_id: existingComment.id,
      body: body,
    });
  } else {
    await context.octokit.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: issueNumber,
      body: body,
    });
  }
}
