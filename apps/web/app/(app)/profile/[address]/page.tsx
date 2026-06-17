import { LiveProfile } from "@/components/LiveProfile";

export default function ProfilePage({ params }: { params: { address: string } }) {
  return <LiveProfile address={params.address} />;
}
