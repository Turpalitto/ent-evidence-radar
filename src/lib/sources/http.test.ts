import { describe, it, expect } from "vitest";
import { decodeEntities, stripTags } from "@/lib/sources/http";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;")).toBe("a & b < c > d \"e\" 'f'");
    expect(decodeEntities("I&#xB2; = 45%; CI 1.4&#8211;3.2; &#x2264; &#8805;")).toBe("I² = 45%; CI 1.4–3.2; ≤ ≥");
  });

  it("leaves unknown or invalid entities untouched and decodes only one level", () => {
    expect(decodeEntities("&unknown; &#0; &#xD800; &#1114112;")).toBe("&unknown; &#0; &#xD800; &#1114112;");
    expect(decodeEntities("&amp;lt;img&amp;gt;")).toBe("&lt;img&gt;");
  });
});

describe("stripTags", () => {
  it("removes inline markup but keeps text order and spacing", () => {
    expect(stripTags("Role of <i>Staphylococcus aureus</i> biofilm: a <b>systematic</b> review")).toBe(
      "Role of Staphylococcus aureus biofilm: a systematic review",
    );
    expect(stripTags("10<sup>6</sup> cells, IL-1<sub>β</sub>, <mml:math><mml:mi>p</mml:mi></mml:math>")).toBe("106 cells, IL-1β, p");
  });

  it("strips tags BEFORE decoding entities, so encoded tags stay inert text", () => {
    expect(stripTags("safe &lt;script&gt;alert(1)&lt;/script&gt;")).toBe("safe <script>alert(1)</script>");
    expect(stripTags("<b>bold</b> &amp; p &lt; 0.05")).toBe("bold & p < 0.05");
  });

  it("collapses whitespace and handles empty input", () => {
    expect(stripTags("  a \n\t b  ")).toBe("a b");
    expect(stripTags(null)).toBe("");
    expect(stripTags(undefined)).toBe("");
  });
});
