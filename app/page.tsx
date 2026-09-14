import NightDoorApp from "@/components/NightDoorApp";
import { ringMode } from "@/lib/ring/client";

export const dynamic = "force-dynamic";

export default function Page() {
  return <NightDoorApp mode={ringMode()} />;
}
