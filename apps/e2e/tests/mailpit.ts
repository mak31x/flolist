import { expect, type APIRequestContext } from "@playwright/test";

const MAILPIT_URL =
  process.env.MAILPIT_URL ?? `http://localhost:${process.env.MAILPIT_UI_PORT ?? "8026"}`;

interface MailpitList {
  messages: { ID: string; Subject: string }[];
}

/** Waits for an email to `to` whose subject matches, and returns the first link in its text. */
export async function linkFromEmail(
  request: APIRequestContext,
  to: string,
  subject: RegExp,
): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:"${to}"` },
        });
        const list = (await res.json()) as MailpitList;
        id = list.messages.find((m) => subject.test(m.Subject))?.ID;
        return id;
      },
      { message: `email to ${to} matching ${String(subject)}`, timeout: 15_000 },
    )
    .toBeTruthy();
  const res = await request.get(`${MAILPIT_URL}/api/v1/message/${id ?? ""}`);
  const { Text } = (await res.json()) as { Text: string };
  const link = /https?:\/\/\S+/.exec(Text)?.[0];
  if (!link) throw new Error(`no link in the email to ${to}`);
  return link;
}
