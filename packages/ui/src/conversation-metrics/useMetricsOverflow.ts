import { useLayoutEffect, useRef, useState } from "react";
import { fitMetricsFields, type MetricsFieldId } from "./contract.js";

/** 测量行保持完整候选集合，避免折叠结果反过来改变测量宽度。 */
export function useMetricsOverflow(fields: readonly MetricsFieldId[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<readonly MetricsFieldId[]>(fields);
  const fieldKey = fields.join(",");
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurement = measurementRef.current;
    if (!container || !measurement) return;
    const candidates = fieldKey.split(",").filter(Boolean) as MetricsFieldId[];
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      const width = container.getBoundingClientRect().width;
      const trigger = measurement.querySelector<HTMLElement>("[data-metric-trigger]");
      const items = Array.from(
        measurement.querySelectorAll<HTMLElement>("[data-measure-metric]"),
      ).map((element) => ({
        id: element.dataset.measureMetric as MetricsFieldId,
        width: element.getBoundingClientRect().width,
      }));
      const next =
        width > 0 && trigger
          ? fitMetricsFields(
              items,
              width,
              trigger.getBoundingClientRect().width,
              Number.parseFloat(getComputedStyle(measurement).columnGap) || 0,
            )
          : candidates;
      setVisible((previous) => (previous.join(",") === next.join(",") ? previous : next));
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(container);
    for (const element of measurement.children) observer?.observe(element);
    return () => {
      observer?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [fieldKey]);
  return { containerRef, measurementRef, visible };
}
