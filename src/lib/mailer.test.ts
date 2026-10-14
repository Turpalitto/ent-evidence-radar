import { afterEach, describe, it, expect, vi } from "vitest";

const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "<id@test>" })));
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail: sendMailMock })));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { buildMessage, getMailerConfig, getRecipients, isMailerConfigured, sendMail } from "@/lib/mailer";

describe("buildMessage (F-21: адреса получателей не раскрываются)", () => {
  const cfg = { from: "radar@example.org" };

  it("несколько получателей уходят в BCC, в To — служебный адрес отправителя", () => {
    const m = buildMessage(["a@x.org", "b@y.org"], "Дайджест", "<p>hi</p>", "hi", cfg);
    expect(m.to).toBe("radar@example.org");
    expect(m.bcc).toEqual(["a@x.org", "b@y.org"]);
    expect(JSON.stringify(m.to)).not.toContain("a@x.org");
  });

  it("единственный получатель остаётся в To", () => {
    const m = buildMessage(["a@x.org"], "Дайджест", "<p>hi</p>", "hi", cfg);
    expect(m.to).toBe("a@x.org");
    expect(m).not.toHaveProperty("bcc");
  });
});

describe("конфигурация SMTP и отправка", () => {
  const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "DIGEST_RECIPIENTS"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    sendMailMock.mockClear();
    createTransport.mockClear();
  });

  it("getMailerConfig читает окружение; from по умолчанию — пользователь; isMailerConfigured требует все обязательные поля", () => {
    for (const k of KEYS) delete process.env[k];
    expect(isMailerConfigured()).toBe(false);
    Object.assign(process.env, { SMTP_HOST: "smtp.example", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "bot@example", SMTP_PASS: "pw" });
    expect(getMailerConfig()).toEqual({ host: "smtp.example", port: 587, secure: false, user: "bot@example", pass: "pw", from: "bot@example" });
    expect(isMailerConfigured()).toBe(true);
    process.env.SMTP_FROM = "ENT Radar <radar@example>";
    expect(getMailerConfig().from).toBe("ENT Radar <radar@example>");
    expect(isMailerConfigured({ host: "h", port: 25, user: "u", pass: "", from: "f" })).toBe(false);
  });

  it("sendMail: без получателей — ничего; без SMTP — dry-run; с SMTP — транспорт и письмо через buildMessage", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await sendMail([], "s", "<p/>", "t", {})).toEqual({ sent: true, to: [], dryRun: false });
    expect(await sendMail(["a@x.org"], "s", "<p/>", "t", { host: "h" })).toEqual({ sent: true, to: ["a@x.org"], dryRun: true });
    expect(createTransport).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("dry-run"), { to: ["a@x.org"], subject: "s" });

    const cfg = { host: "smtp.example", port: 465, secure: true, user: "bot", pass: "pw", from: "radar@example" };
    const res = await sendMail(["a@x.org", "b@y.org"], "Дайджест", "<p>hi</p>", "hi", cfg);
    expect(res).toEqual({ sent: true, to: ["a@x.org", "b@y.org"], dryRun: false });
    expect(createTransport).toHaveBeenCalledWith({ host: "smtp.example", port: 465, secure: true, auth: { user: "bot", pass: "pw" } });
    expect(sendMailMock).toHaveBeenCalledWith(buildMessage(["a@x.org", "b@y.org"], "Дайджест", "<p>hi</p>", "hi", cfg));
    // Транспорт создаётся один раз на процесс.
    await sendMail(["c@z.org"], "s2", "<p/>", "t", cfg);
    expect(createTransport).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it("getRecipients: настройки важнее окружения; разделители , ; и пробелы; дедупликация без учёта регистра", () => {
    process.env.DIGEST_RECIPIENTS = "Env@x.org";
    expect(getRecipients("  ")).toEqual(["env@x.org"]);
    expect(getRecipients("A@x.org, a@x.org; b@y.org\nc@z.org")).toEqual(["a@x.org", "b@y.org", "c@z.org"]);
    delete process.env.DIGEST_RECIPIENTS;
    expect(getRecipients(null)).toEqual([]);
  });
});
