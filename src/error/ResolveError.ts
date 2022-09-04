export class ResolveError extends Error {
  constructor(ref: string) {
    super(`Failed to resolve: ${ref}`);
  }
}