import { useParams } from "react-router-dom";
import { isRecordId } from "@/lib/record-id";
import Quotes from "@/pages/Quotes";
import QuoteView from "@/pages/QuoteView";

export default function QuoteRoute() {
  const { id } = useParams<{ id: string }>();
  if (isRecordId(id)) return <QuoteView />;
  return <Quotes />;
}
