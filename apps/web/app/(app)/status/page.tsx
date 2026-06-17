import { LiveStatus } from "@/components/LiveStatus";

export default function StatusPage() {
  const contracts = [
    { name: "PhronosRegistry", address: process.env.PHRONOS_REGISTRY_ADDR ?? "" },
    { name: "PhronosBond",     address: process.env.PHRONOS_BOND_ADDR     ?? "" },
    { name: "PhronosRouter",   address: process.env.PHRONOS_ROUTER_ADDR   ?? "" },
    { name: "SlashOracle",     address: process.env.SLASH_ORACLE_ADDR     ?? "" },
  ].filter(c => c.address);

  return <LiveStatus contracts={contracts} />;
}
