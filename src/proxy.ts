import middleware from "next-auth/middleware";

export default middleware;

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
