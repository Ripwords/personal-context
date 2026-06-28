export default defineNuxtRouteMiddleware(async (to) => {
  // Always allow the login page through
  if (to.path === "/login") return;

  // Use useRequestFetch so cookies are forwarded during SSR
  const { authenticated } = await useRequestFetch()<{ authenticated: boolean }>(
    "/api/auth-status"
  );

  if (!authenticated) {
    return navigateTo("/login");
  }
});
