import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { config } from "../config.js";
import { getDb, sql } from "../db/pool.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid payload" });

    const { username, password } = parsed.data;
    const db = await getDb();
    const result = await db.request()
      .input("Username", sql.NVarChar(50), username)
      .query("SELECT * FROM Users WHERE Username = @Username AND IsActive = 1");

    const user = result.recordset[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    if (user.LockedUntil && new Date(user.LockedUntil) > new Date()) {
      return res.status(423).json({ error: "Account temporarily locked. Try again later or ask admin." });
    }

    const valid = await bcrypt.compare(password, user.PasswordHash);
    if (!valid) {
      const attempts = (user.LoginAttempts || 0) + 1;
      if (attempts >= config.maxLoginAttempts) {
        const lockUntil = new Date(Date.now() + config.lockoutMinutes * 60_000);
        await db.request()
          .input("UserID", sql.Int, user.UserID)
          .input("Attempts", sql.Int, attempts)
          .input("LockedUntil", sql.DateTime2, lockUntil)
          .query("UPDATE Users SET LoginAttempts = @Attempts, LockedUntil = @LockedUntil WHERE UserID = @UserID");
      } else {
        await db.request()
          .input("UserID", sql.Int, user.UserID)
          .input("Attempts", sql.Int, attempts)
          .query("UPDATE Users SET LoginAttempts = @Attempts WHERE UserID = @UserID");
      }
      return res.status(401).json({ error: "Invalid credentials" });
    }

    await db.request()
      .input("UserID", sql.Int, user.UserID)
      .input("LastLogin", sql.DateTime2, new Date())
      .query("UPDATE Users SET LoginAttempts = 0, LockedUntil = NULL, LastLogin = @LastLogin WHERE UserID = @UserID");

    const token = jwt.sign(
      { userId: user.UserID, username: user.Username, role: user.Role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as SignOptions
    );

    const sessionId = uuidv4();
    await db.request()
      .input("SessionID", sql.NVarChar(100), sessionId)
      .input("UserID", sql.Int, user.UserID)
      .input("TokenHash", sql.NVarChar(255), await bcrypt.hash(token, 5))
      .input("IPAddress", sql.NVarChar(45), req.ip)
      .input("UserAgent", sql.NVarChar(500), req.headers["user-agent"] || "")
      .input("ExpiresAt", sql.DateTime2, new Date(Date.now() + 8 * 60 * 60 * 1000))
      .query(`INSERT INTO UserSessions (SessionID, UserID, TokenHash, IPAddress, UserAgent, ExpiresAt)
              VALUES (@SessionID, @UserID, @TokenHash, @IPAddress, @UserAgent, @ExpiresAt)`);

    res.json({
      token,
      sessionId,
      user: {
        userId: user.UserID,
        username: user.Username,
        fullName: user.FullName,
        role: user.Role,
        email: user.Email,
        department: user.Department,
        branch: user.Branch
      }
    });
  } catch (err) {
    next(err);
  }
}

export const authRouter = Router();

authRouter.post("/logout", async (req, res, next) => {
  try {
    const sessionId = String(req.headers["x-session-id"] || "");
    if (sessionId) {
      const db = await getDb();
      await db.request()
        .input("SessionID", sql.NVarChar(100), sessionId)
        .query("UPDATE UserSessions SET IsActive = 0 WHERE SessionID = @SessionID");
    }
    res.json({ message: "Logged out" });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const db = await getDb();
    const result = await db.request()
      .input("UserID", sql.Int, userId)
      .query("SELECT UserID, Username, Email, FullName, Role, Department, Branch, IsActive, LastLogin FROM Users WHERE UserID = @UserID");
    const user = result.recordset[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});
