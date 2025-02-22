import { SupabaseClient } from "@supabase/supabase-js";
import { SuperSupabase } from "./supabase";
import { Context } from "../../../types/context";
import { markdownToPlainText } from "../../utils/markdown-to-plaintext";

export interface IssueSimilaritySearchResult {
  issue_id: string;
  issue_plaintext: string;
  similarity: number;
}

export class Issues extends SuperSupabase {
  constructor(supabase: SupabaseClient, context: Context) {
    super(supabase, context);
  }

  async createIssue(issueNodeId: string, payload: Record<string, unknown> | null, isPrivate: boolean, markdown: string | null, authorId: number) {
    //First Check if the issue already exists
    const { data, error } = await this.supabase.from("issues").select("*").eq("id", issueNodeId);
    if (error) {
      this.context.logger.error("Error creating issue", error);
      return;
    }
    if (data && data.length > 0) {
      this.context.logger.info("Issue already exists");
      return;
    } else {
      const embedding = await this.context.adapters.voyage.embedding.createEmbedding(markdown);
      let plaintext: string | null = markdownToPlainText(markdown || "");
      if (isPrivate) {
        payload = null;
        markdown = null;
        plaintext = null;
      }
      const { error } = await this.supabase.from("issues").insert([{ id: issueNodeId, payload, markdown, plaintext, author_id: authorId, embedding }]);
      if (error) {
        this.context.logger.error("Error creating issue", error);
        return;
      }
    }
    this.context.logger.info("Issue created successfully");
  }

  async updateIssue(markdown: string | null, issueNodeId: string, payload: Record<string, unknown> | null, isPrivate: boolean) {
    //Create the embedding for this comment
    const embedding = Array.from(await this.context.adapters.voyage.embedding.createEmbedding(markdown));
    let plaintext: string | null = markdownToPlainText(markdown || "");
    if (isPrivate) {
      markdown = null as string | null;
      payload = null as Record<string, unknown> | null;
      plaintext = null as string | null;
    }
    const { error } = await this.supabase
      .from("issues")
      .update({ markdown, plaintext, embedding: embedding, payload, modified_at: new Date() })
      .eq("id", issueNodeId);
    if (error) {
      this.context.logger.error("Error updating comment", error);
    }
  }

  async deleteIssue(issueNodeId: string) {
    const { error } = await this.supabase.from("issues").delete().eq("id", issueNodeId);
    if (error) {
      this.context.logger.error("Error deleting comment", error);
    }
  }

  async findSimilarIssues(markdown: string, threshold: number, currentId: string): Promise<IssueSimilaritySearchResult[] | null> {
    const embedding = await this.context.adapters.voyage.embedding.createEmbedding(markdown);
    const { data, error } = await this.supabase.rpc("find_similar_issues", {
      current_id: currentId,
      query_embedding: embedding,
      threshold: threshold,
    });
    if (error) {
      this.context.logger.error("Error finding similar issues", error);
      return [];
    }
    return data;
  }
}
