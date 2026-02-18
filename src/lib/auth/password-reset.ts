export function validatePasswordMatch(
  password: string,
  confirmPassword: string
): string | null {
  if (password.length < 6) {
    return "Password must be at least 6 characters";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}
