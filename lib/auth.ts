import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/lib/db";
import { eq } from "drizzle-orm";
import { users, accounts } from "@/lib/db/schema";
import { authSchema } from "./validation";
import { comparePassword } from "./utils";
import { generateAvatarUrl } from "./avatar";

export const {
    handlers: { GET, POST },
    auth,
    signIn,
    signOut
} = NextAuth(() => ({
    secret: process.env.AUTH_SECRET!,
    adapter: DrizzleAdapter(getDb(), {
        usersTable: users,
            accountsTable: accounts,
        }),
        session: {
            strategy: "jwt",
        },
        providers: [
            GithubProvider({
                clientId: process.env.AUTH_GITHUB_ID!,
                clientSecret: process.env.AUTH_GITHUB_SECRET!,
                checks: ["pkce", "state"], // 新增这一行：跳过对新版 iss 参数的隐式发行方校验
                issuer: "https://github.com/login/oauth",
            }),
            CredentialsProvider({
                name: "credentials",
                credentials: {
                    username: { label: "用户名", type: "text", placeholder: "请输入用户名" },
                    password: { label: "密码", type: "password", placeholder: "请输入密码" },
                },
                async authorize(credentials) {
                    if (!credentials) {
                        throw new Error("请输入用户名和密码")
                    }

                    const { username, password } = credentials

                    try {
                        authSchema.parse({ username, password })
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    } catch (error) {
                        throw new Error("输入格式不正确")
                    }

                    const db = getDb()

                    const user = await db.query.users.findFirst({
                        where: eq(users.username, username as string),
                    })

                    if (!user) {
                        throw new Error("用户名或密码错误")
                    }

                    const isValid = await comparePassword(password as string, user.password as string)
                    if (!isValid) {
                        throw new Error("用户名或密码错误")
                    }

                    return {
                        ...user,
                        password: undefined,
                    }
                },
            })
        ],
        callbacks: {
            async session({ token, session }) {
                if (token && session.user) {
                    session.user.id = token.id as string
                    session.user.name = token.name as string
                    session.user.username = token.username as string
                    session.user.image = token.image as string
                }
                return session;
            },
            async jwt({ token, user }) {
                if (user) {
                    token.id = user.id
                    token.name = user.name || user.username
                    token.username = user.username
                    token.image = user.image || generateAvatarUrl(token.name as string)
                }
                return token
            },
    }
}));
