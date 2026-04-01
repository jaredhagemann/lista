"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserPlus } from "lucide-react";

export function AddMemberButton() {
  const router = useRouter();

  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
