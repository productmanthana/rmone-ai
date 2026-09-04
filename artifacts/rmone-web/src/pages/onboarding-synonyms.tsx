import { useLocation } from "wouter";
import { ArrowLeft, BookMarked } from "lucide-react";
import { Button } from "@/components/ui/button";
import SynonymsManager from "@/components/synonyms-manager";

export default function OnboardingSynonymsPage() {
  const [, navigate] = useLocation();

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/import")}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <BookMarked className="w-6 h-6 text-[#6BA539]" />
          <div>
            <h1 className="text-xl font-semibold">Column Synonyms</h1>
            <p className="text-sm text-muted-foreground">
              Teach RM ONE to recognise your column names. Custom synonyms are picked up automatically on the next upload.
            </p>
          </div>
        </div>
      </div>
      <SynonymsManager />
    </div>
  );
}
