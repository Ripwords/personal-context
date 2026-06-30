export default defineNuxtRouteMiddleware(async (to) => {
  // Use useRequestFetch so cookies are forwarded during SSR
  const { authenticated } = await useRequestFetch()<{ authenticated: boolean }>(
    "/api/auth-status"
  );

  // Authenticated users have no reason to sit on /login — send them home.
  if (to.path === "/login") {
    return authenticated ? navigateTo("/") : undefined;
  }

  if (!authenticated) {
    return navigateTo("/login");
  }
});
