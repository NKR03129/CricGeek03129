export interface CommentaryUser {
  id: string;
  role: string;
}

export function canCreateCommentarySession(user?: CommentaryUser | null): boolean {
  return Boolean(user?.id);
}

export function canManageCommentarySession(
  user: CommentaryUser | null | undefined,
  moderatorId: string
): boolean {
  if (!user?.id) {
    return false;
  }

  return user.role === "admin" || user.id === moderatorId;
}
