import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import { parseSingleUseLinkInput } from "../meeting-type-input";

export function newSingleUseToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createSingleUseLink(meetingTypeId: string, body: Record<string, unknown>) {
  const fields = parseSingleUseLinkInput(body);
  return prisma.singleUseLink.create({
    data: { meetingTypeId, token: newSingleUseToken(), ...fields },
  });
}
