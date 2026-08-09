export interface JwtPayload {
  sub: string;       // userId
  role: string;      // UserRole
  sessionId: string;
  iat?: number;
  exp?: number;
}
