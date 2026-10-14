import { describe, it, expect } from "vitest";
import { buildMessage } from "@/lib/mailer";

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
