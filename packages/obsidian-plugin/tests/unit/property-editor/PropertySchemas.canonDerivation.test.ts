import { FALLBACK_EFFORT_STATUS_VALUES } from "../../../src/domain/property-editor/PropertySchemas";
import {
  EFFORT_STATUS_UID,
  EffortStatus,
} from "@kitelev/exocortex-core/domain/constants";

/**
 * Что здесь заперто (issue #4122).
 *
 * До этого шесть статусных UID жили в PropertySchemas ЛИТЕРАЛЬНОЙ копией
 * рядом с `EFFORT_STATUS_UID`. Ни один тест не сравнивал два списка, поэтому
 * расхождение прошло бы МОЛЧА: существующий PropertySchemas.test.ts (56 осей)
 * проверяет ЗНАЧЕНИЯ выдачи и остался бы зелёным при любом дрейфе канона.
 *
 * ⛤ Оси ниже проверяют не выдачу, а ПРОИЗВОДНОСТЬ — то, чего 56 осей не видят.
 */
describe("FALLBACK_EFFORT_STATUS_VALUES выведен из канона", () => {
  const labelOf = (s: EffortStatus) => s.replace(/^ems__EffortStatus/, "");

  it("каждый UID берётся из EFFORT_STATUS_UID, а не из литерала", () => {
    for (const entry of FALLBACK_EFFORT_STATUS_VALUES) {
      const symbol = (Object.values(EffortStatus) as EffortStatus[]).find(
        (s) => labelOf(s) === entry.label,
      );
      expect(symbol).toBeDefined();
      expect(entry.value).toBe(`[[${EFFORT_STATUS_UID[symbol!]}]]`);
    }
  });

  it("wikilink согласован с тем же UID и меткой", () => {
    for (const entry of FALLBACK_EFFORT_STATUS_VALUES) {
      const uid = entry.value.slice(2, -2);
      expect(entry.wikilink).toBe(`[[${uid}|${entry.label}]]`);
    }
  });

  it("представлены ВСЕ статусы канона, ровно по одному разу", () => {
    const labels = FALLBACK_EFFORT_STATUS_VALUES.map((e) => e.label).sort();
    const expected = (Object.keys(EFFORT_STATUS_UID) as EffortStatus[])
      .map(labelOf)
      .sort();
    expect(labels).toEqual(expected);
  });

  /**
   * ⛔ Ось-предохранитель. Порядок списка — решение про UX (сперва рабочие
   * статусы, `Draft` в конец), порядок канона — про жизненный цикл
   * (`Draft` первым). Они РАЗНЫЕ, и «упрощение» до `Object.keys(EFFORT_STATUS_UID)`
   * молча переставило бы `Draft` на первую позицию выпадающего списка.
   *
   * Эта ось краснеет ровно на такой замене.
   */
  it("порядок списка НЕ наследуется от канона (Draft последним, не первым)", () => {
    const listOrder = FALLBACK_EFFORT_STATUS_VALUES.map((e) => e.label);
    const canonOrder = (Object.keys(EFFORT_STATUS_UID) as EffortStatus[]).map(labelOf);

    expect(listOrder).not.toEqual(canonOrder);
    expect(listOrder[listOrder.length - 1]).toBe("Draft");
    expect(canonOrder[0]).toBe("Draft");
    expect(listOrder[0]).toBe("Backlog");
  });
});
