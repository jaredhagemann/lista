"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];

const RELATIONSHIPS = ["Self", "Mother", "Father", "Guardian", "Emergency", "Other"];

export function ContactsCard({
  profileId,
  contacts: initialContacts,
}: {
  profileId: string;
  contacts: Contact[];
}) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);

  // Form fields
  const [relationship, setRelationship] = useState("Self");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [receivesEmail, setReceivesEmail] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  function resetForm() {
    setRelationship("Self");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setStreet("");
    setCity("");
    setState("");
    setZip("");
    setReceivesEmail(false);
  }

  function openAdd() {
    setEditingContact(null);
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditingContact(contact);
    setRelationship(contact.relationship);
    setFirstName(contact.first_name);
    setLastName(contact.last_name);
    setEmail(contact.email ?? "");
    setPhone(contact.phone ?? "");
    setStreet(contact.street ?? "");
    setCity(contact.city ?? "");
    setState(contact.state ?? "");
    setZip(contact.zip ?? "");
    setReceivesEmail(contact.receives_email);
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      profile_id: profileId,
      relationship,
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      phone: phone || null,
      street: street || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      receives_email: receivesEmail,
    };

    if (editingContact) {
      const { error } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", editingContact.id);

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      setContacts((prev) =>
        prev.map((c) =>
          c.id === editingContact.id ? { ...c, ...payload } : c
        )
      );
      toast.success("Contact updated");
    } else {
      const id = crypto.randomUUID();
      const { error } = await supabase
        .from("contacts")
        .insert({ id, ...payload });

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      setContacts((prev) => [
        ...prev,
        { id, ...payload, created_at: new Date().toISOString() },
      ]);
      toast.success("Contact added");
    }

    setDialogOpen(false);
    setLoading(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!deleteContact) return;
    setLoading(true);

    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", deleteContact.id);

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    setContacts((prev) => prev.filter((c) => c.id !== deleteContact.id));
    setDeleteContact(null);
    setLoading(false);
    toast.success("Contact deleted");
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Contact Information</CardTitle>
              <CardDescription>
                Manage your contacts for team communications.
              </CardDescription>
            </div>
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet. Add one to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between rounded-md border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {contact.relationship}
                      </Badge>
                      <span className="font-medium">
                        {contact.first_name} {contact.last_name}
                      </span>
                    </div>
                    {(contact.email || contact.phone) && (
                      <p className="text-sm text-muted-foreground">
                        {[contact.email, contact.phone]
                          .filter(Boolean)
                          .join(" \u00B7 ")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(contact)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteContact(contact)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingContact ? "Edit Contact" : "Add Contact"}
            </DialogTitle>
            <DialogDescription>
              {editingContact
                ? "Update this contact's information."
                : "Add a new contact for team communications."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="contact-relationship">Relationship</Label>
                <Select value={relationship} onValueChange={setRelationship}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIPS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contact-first-name">First name</Label>
                  <Input
                    id="contact-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-last-name">Last name</Label>
                  <Input
                    id="contact-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contact-email">Email</Label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-phone">Phone</Label>
                  <Input
                    id="contact-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-street">Street</Label>
                <Input
                  id="contact-street"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contact-city">City</Label>
                  <Input
                    id="contact-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-state">State</Label>
                  <Input
                    id="contact-state"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-zip">Zip</Label>
                  <Input
                    id="contact-zip"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="contact-receives-email"
                  checked={receivesEmail}
                  onCheckedChange={setReceivesEmail}
                />
                <Label htmlFor="contact-receives-email">
                  Receives team emails
                </Label>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteContact}
        onOpenChange={(open) => !open && setDeleteContact(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>
                {deleteContact?.first_name} {deleteContact?.last_name}
              </strong>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteContact(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
