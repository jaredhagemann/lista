"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Database } from "@/types/database";

type Location = Database["public"]["Tables"]["locations"]["Row"];

export type LocationChoice = { locationId: string; newName: string; newAddress: string; adding: boolean };

export const noLocation = (locationId = ""): LocationChoice => ({
  locationId,
  newName: "",
  newAddress: "",
  adding: false,
});

/**
 * The location chosen, as an id: a new one is saved first. Returns an error
 * message instead when it can't be.
 */
export async function resolveLocation(
  supabase: ReturnType<typeof createClient>,
  teamId: string,
  choice: LocationChoice
): Promise<{ id: string | null } | { error: string }> {
  if (choice.adding && choice.newName.trim()) {
    const id = crypto.randomUUID();
    const { error } = await supabase.from("locations").insert({
      id,
      team_id: teamId,
      name: choice.newName.trim(),
      address: choice.newAddress.trim() || null,
    });
    if (error) return { error: `Failed to create location: ${error.message}` };
    return { id };
  }
  return { id: choice.locationId || null };
}

/** The team's locations, or a new one, as the event forms offer them. */
export function LocationField({
  teamId,
  value,
  onChange,
}: {
  teamId: string;
  value: LocationChoice;
  onChange: (choice: LocationChoice) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    supabase
      .from("locations")
      .select("*")
      .eq("team_id", teamId)
      .order("name")
      .then(({ data }) => {
        if (data) setLocations(data);
      });
  }, [teamId, supabase]);

  return (
    <div className="space-y-2">
      <Label>Location</Label>
      {!value.adding ? (
        <Select
          value={value.locationId}
          onValueChange={(v) =>
            onChange(v === "__new__" ? { ...value, adding: true, locationId: "" } : { ...value, locationId: v })
          }
        >
          <SelectTrigger aria-label="Location">
            <SelectValue placeholder="Select a location" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>
                {loc.name}
              </SelectItem>
            ))}
            <SelectItem value="__new__">+ Add new location</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <Input
            placeholder="Location name"
            value={value.newName}
            onChange={(e) => onChange({ ...value, newName: e.target.value })}
          />
          <Input
            placeholder="Address (optional)"
            value={value.newAddress}
            onChange={(e) => onChange({ ...value, newAddress: e.target.value })}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(noLocation())}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
