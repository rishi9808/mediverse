const INDIA_TIME_ZONE = "Asia/Kolkata";

export function getIndiaTimeGreeting(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: INDIA_TIME_ZONE,
    }).format(date),
  );

  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
