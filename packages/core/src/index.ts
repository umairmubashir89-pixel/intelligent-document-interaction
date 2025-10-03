export type Role = "system" | "user" | "assistant" | "tool";
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  toolCall?: { name: string; args: unknown };
  metadata?: Record<string, unknown>;
}
export const APP_NAME = "ARGON";
