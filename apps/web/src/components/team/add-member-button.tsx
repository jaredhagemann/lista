"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserPlus } from "lucide-react";
import { BulkInviteModal } from "./bulk-invite-modal";

interface AddMemberButtonProps {
  teamId: string;
}

export function AddMemberButton({ teamId }: AddMemberButtonProps) {
  const router = useRouter();
  const [bulkOpen, setBulkOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <UserPlus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => router.push("/dashboard/team/new-member?role=player")}
          >
            Player
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push("/dashboard/team/new-member?role=manager")}
          >
            Manager
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push("/dashboard/team/new-member?role=coach")}
          >
            Coach
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setBulkOpen(true)}>
            Bulk invite
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BulkInviteModal teamId={teamId} open={bulkOpen} onOpenChange={setBulkOpen} />
    </>
  );
}
