export function isAdminRole(role?: string | null): boolean {
  return role === "admin";
}

export function isWriterRole(role?: string | null): boolean {
  return role === "writer" || role === "admin";
}

export function canPublishBlogs(role?: string | null): boolean {
  return isWriterRole(role);
}
