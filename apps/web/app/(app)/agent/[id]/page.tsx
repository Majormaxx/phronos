import { LiveAgent } from "@/components/LiveAgent";
import { getDeployedAddresses } from "@phronos/shared";

export default function AgentPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (isNaN(id)) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-ink/40">Invalid agent ID.</p>
      </div>
    );
  }
  const { registry: registryAddr, bond: bondAddr, router: routerAddr } = getDeployedAddresses();
  return (
    <LiveAgent
      id={id}
      contracts={{
        registryAddr: registryAddr || undefined,
        bondAddr:     bondAddr     || undefined,
        routerAddr:   routerAddr   || undefined,
      }}
    />
  );
}
