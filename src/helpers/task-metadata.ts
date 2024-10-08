import { DateTime } from "luxon";
import { Context } from "../types/context";
import { ListCommentsForIssue, ListForOrg, ListIssueForRepo } from "../types/github-types";
import ms from "ms";

export async function getTaskMetadata(
  context: Context,
  repo: ListForOrg["data"][0],
  issue: ListIssueForRepo
): Promise<{ metadata: { taskDeadline: string; taskAssignees: number[] }; lastCheck: DateTime } | false> {
  const { logger, octokit } = context;

  const comments = (await octokit.paginate(octokit.rest.issues.listComments, {
    owner: repo.owner.login,
    repo: repo.name,
    issue_number: issue.number,
    per_page: 100,
  })) as ListCommentsForIssue[];

  const botComments = comments.filter((o) => o.user?.type === "Bot");
  // Has the bot assigned them, typically via the `/start` command
  const assignmentRegex = /Ubiquity - Assignment - start -/gi;
  const botAssignmentComments = botComments
    .filter((o) => assignmentRegex.test(o?.body || ""))
    .sort((a, b) => DateTime.fromISO(a.created_at).toMillis() - DateTime.fromISO(b.created_at).toMillis());

  // Has the bot previously reminded them?
  const botFollowup = /<!-- Ubiquity - Followup - remindAssignees/gi;
  const botFollowupComments = botComments
    .filter((o) => botFollowup.test(o?.body || ""))
    .sort((a, b) => DateTime.fromISO(a.created_at).toMillis() - DateTime.fromISO(b.created_at).toMillis());

  // `lastCheck` represents the last time the bot intervened in the issue, separate from the activity tracking of a user.
  const lastCheckComment = botFollowupComments[0]?.created_at ? botFollowupComments[0] : botAssignmentComments[0];
  let lastCheck = lastCheckComment?.created_at ? DateTime.fromISO(lastCheckComment.created_at) : null;

  // if we don't have a lastCheck yet, use the assignment event
  if (!lastCheck) {
    logger.info("No last check found, using assignment event");
    const assignmentEvents = await octokit.paginate(octokit.rest.issues.listEvents, {
      owner: repo.owner.login,
      repo: repo.name,
      issue_number: issue.number,
    });

    const assignmentEvent = assignmentEvents.find((o) => o.event === "assigned");
    if (assignmentEvent) {
      lastCheck = DateTime.fromISO(assignmentEvent.created_at);
    } else {
      logger.error(`Failed to find last check for ${issue.html_url}`);
      return false;
    }
  }

  if (!lastCheck) {
    logger.error(`Failed to find last check for ${issue.html_url}`);
    return false;
  }

  const metadata = {
    taskDeadline: "",
    taskAssignees: issue.assignees ? issue.assignees.map((o) => o.id) : issue.assignee ? [issue.assignee.id] : [],
  };

  if (!metadata.taskAssignees?.length) {
    logger.error(`Missing Assignees from ${issue.html_url}`);
    return false;
  }

  const durationInMs = parseTimeLabel(issue.labels);

  if (durationInMs === 0) {
    // it could mean there was no time label set on the issue
    // but it could still be workable and priced
  } else if (durationInMs < 0 || !durationInMs) {
    logger.error(`Invalid deadline found on ${issue.html_url}`);
    return false;
  }

  metadata.taskDeadline = DateTime.fromMillis(lastCheck.toMillis() + durationInMs).toISO() || "";

  return { metadata, lastCheck };
}

function parseTimeLabel(
  labels: (
    | string
    | {
        id?: number;
        node_id?: string;
        url?: string;
        name?: string;
        description?: string | null;
        color?: string | null;
        default?: boolean;
      }
  )[]
): number {
  let taskTimeEstimate = 0;

  for (const label of labels) {
    let timeLabel = "";
    if (typeof label === "string") {
      timeLabel = label;
    } else {
      timeLabel = label.name || "";
    }

    if (timeLabel.startsWith("Time:")) {
      const matched = timeLabel.match(/Time: <(\d+) (\w+)/i);
      if (!matched) {
        return 0;
      }

      const [_, duration, unit] = matched;
      taskTimeEstimate = ms(`${duration} ${unit}`);
    }

    if (taskTimeEstimate) {
      break;
    }
  }

  return taskTimeEstimate;
}
