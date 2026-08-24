export function shortIface(value: string | undefined | null): string {
  return (value || "")
    .replace(/TwentyFiveGigE/i, "Twe")
    .replace(/HundredGigE/i, "Hu")
    .replace(/FortyGigabitEthernet/i, "Fo")
    .replace(/TenGigabitEthernet/i, "Te")
    .replace(/GigabitEthernet/i, "Gi")
    .replace(/FastEthernet/i, "Fa")
    .replace(/^port/i, "Port ");
}
