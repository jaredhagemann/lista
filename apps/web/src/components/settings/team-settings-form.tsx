"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ImageUpload } from "@/components/ui/image-upload";
import type { Database } from "@/types/database";

type Team = Database["public"]["Tables"]["teams"]["Row"];

const SPORTS = [
  { value: "baseball", label: "Baseball" },
  { value: "basketball", label: "Basketball" },
  { value: "cricket", label: "Cricket" },
  { value: "field_hockey", label: "Field Hockey" },
  { value: "flag_football", label: "Flag Football" },
  { value: "football", label: "Football" },
  { value: "golf", label: "Golf" },
  { value: "gymnastics", label: "Gymnastics" },
  { value: "ice_hockey", label: "Ice Hockey" },
  { value: "lacrosse", label: "Lacrosse" },
  { value: "pickleball", label: "Pickleball" },
  { value: "rugby", label: "Rugby" },
  { value: "soccer", label: "Soccer" },
  { value: "softball", label: "Softball" },
  { value: "swimming", label: "Swimming" },
  { value: "tennis", label: "Tennis" },
  { value: "track_and_field", label: "Track & Field" },
  { value: "volleyball", label: "Volleyball" },
  { value: "wrestling", label: "Wrestling" },
  { value: "other", label: "Other" },
] as const;

const AGE_GROUPS = [
  { value: "6u", label: "6U" },
  { value: "7u", label: "7U" },
  { value: "8u", label: "8U" },
  { value: "9u", label: "9U" },
  { value: "10u", label: "10U" },
  { value: "11u", label: "11U" },
  { value: "12u", label: "12U" },
  { value: "13u", label: "13U" },
  { value: "14u", label: "14U" },
  { value: "15u", label: "15U" },
  { value: "16u", label: "16U" },
  { value: "17u", label: "17U" },
  { value: "18u", label: "18U" },
  { value: "high_school", label: "High School" },
  { value: "college", label: "College" },
  { value: "adult", label: "Adult" },
] as const;

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "coed", label: "Coed" },
] as const;

const COMMON_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexico" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
];

const ALL_COUNTRIES: { code: string; name: string }[] = [
  { code: "AF", name: "Afghanistan" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AR", name: "Argentina" },
  { code: "AT", name: "Austria" },
  { code: "AU", name: "Australia" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "CR", name: "Costa Rica" },
  { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "GT", name: "Guatemala" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "KE", name: "Kenya" },
  { code: "KR", name: "South Korea" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NG", name: "Nigeria" },
  { code: "NO", name: "Norway" },
  { code: "PA", name: "Panama" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" },
  { code: "RO", name: "Romania" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SG", name: "Singapore" },
  { code: "ZA", name: "South Africa" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "TW", name: "Taiwan" },
  { code: "TH", name: "Thailand" },
  { code: "TR", name: "Turkey" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
];

function formatLabel(
  value: string | null,
  options: readonly { value: string; label: string }[]
): string {
  if (!value) return "—";
  const match = options.find((o) => o.value === value);
  return match ? match.label : value;
}

function countryName(code: string | null): string {
  if (!code) return "—";
  const match = ALL_COUNTRIES.find((c) => c.code === code);
  return match ? match.name : code;
}

interface TeamSettingsFormProps {
  team: Team;
  isAdmin: boolean;
}

export function TeamSettingsForm({ team, isAdmin }: TeamSettingsFormProps) {
  const [editing, setEditing] = useState(false);
  const [teamName, setTeamName] = useState(team.name);
  const [season, setSeason] = useState(team.season ?? "");
  const [sport, setSport] = useState(team.sport ?? "");
  const [league, setLeague] = useState(team.league ?? "");
  const [leagueUrl, setLeagueUrl] = useState(team.league_url ?? "");
  const [ageGroup, setAgeGroup] = useState(team.age_group ?? "");
  const [gender, setGender] = useState(team.gender ?? "");
  const [homeUniform, setHomeUniform] = useState(team.home_uniform ?? "");
  const [awayUniform, setAwayUniform] = useState(team.away_uniform ?? "");
  const [timezone, setTimezone] = useState(team.timezone ?? "");
  const [country, setCountry] = useState(team.country ?? "");
  const [zip, setZip] = useState(team.zip ?? "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const timezones = [
    // North America
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Toronto",
    "America/Vancouver",
    "America/Winnipeg",
    "America/Halifax",
    "America/St_Johns",
    "America/Mexico_City",
    // Central & South America
    "America/Bogota",
    "America/Lima",
    "America/Santiago",
    "America/Buenos_Aires",
    "America/Sao_Paulo",
    "America/Caracas",
    // Europe
    "Europe/London",
    "Europe/Dublin",
    "Europe/Lisbon",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Rome",
    "Europe/Madrid",
    "Europe/Amsterdam",
    "Europe/Brussels",
    "Europe/Zurich",
    "Europe/Stockholm",
    "Europe/Oslo",
    "Europe/Copenhagen",
    "Europe/Helsinki",
    "Europe/Warsaw",
    "Europe/Prague",
    "Europe/Vienna",
    "Europe/Budapest",
    "Europe/Bucharest",
    "Europe/Athens",
    "Europe/Istanbul",
    "Europe/Moscow",
    // Africa
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Africa/Lagos",
    "Africa/Nairobi",
    // Middle East
    "Asia/Dubai",
    "Asia/Riyadh",
    "Asia/Kuwait",
    "Asia/Tehran",
    "Asia/Jerusalem",
    "Asia/Beirut",
    // Asia
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Dhaka",
    "Asia/Colombo",
    "Asia/Kathmandu",
    "Asia/Tashkent",
    "Asia/Almaty",
    "Asia/Bangkok",
    "Asia/Ho_Chi_Minh",
    "Asia/Jakarta",
    "Asia/Kuala_Lumpur",
    "Asia/Singapore",
    "Asia/Manila",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Taipei",
    "Asia/Seoul",
    "Asia/Tokyo",
    // Oceania
    "Australia/Perth",
    "Australia/Darwin",
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Sydney",
    "Australia/Melbourne",
    "Pacific/Auckland",
    "Pacific/Fiji",
    // UTC
    "UTC",
  ];

  const commonCountryCodes = new Set(COMMON_COUNTRIES.map((c) => c.code));
  const otherCountries = ALL_COUNTRIES.filter(
    (c) => !commonCountryCodes.has(c.code)
  );

  function handleCancel() {
    setTeamName(team.name);
    setSeason(team.season ?? "");
    setSport(team.sport ?? "");
    setLeague(team.league ?? "");
    setLeagueUrl(team.league_url ?? "");
    setAgeGroup(team.age_group ?? "");
    setGender(team.gender ?? "");
    setHomeUniform(team.home_uniform ?? "");
    setAwayUniform(team.away_uniform ?? "");
    setTimezone(team.timezone ?? "");
    setCountry(team.country ?? "");
    setZip(team.zip ?? "");
    setEditing(false);
  }

  async function handleSave() {
    setLoading(true);

    const { error } = await supabase
      .from("teams")
      .update({
        name: teamName,
        season: season || null,
        sport: sport || null,
        league: league || null,
        league_url: leagueUrl || null,
        age_group: ageGroup || null,
        gender: gender || null,
        home_uniform: homeUniform || null,
        away_uniform: awayUniform || null,
        timezone: timezone || null,
        country: country || null,
        zip: zip || null,
      })
      .eq("id", team.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Team updated");
      router.refresh();
      setEditing(false);
    }

    setLoading(false);
  }

  function renderField(label: string, readValue: string, editElement: React.ReactNode) {
    return (
      <>
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        {editing ? editElement : <span className="text-sm">{readValue}</span>}
      </>
    );
  }

  function renderSelect(
    value: string,
    onValueChange: (v: string) => void,
    options: readonly { value: string; label: string }[],
    placeholder: string
  ) {
    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__clear__">
            <span className="text-muted-foreground">{placeholder}</span>
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  function handleSelectChange(setter: (v: string) => void) {
    return (v: string) => setter(v === "__clear__" ? "" : v);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Team Details</CardTitle>
        {isAdmin && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {isAdmin && editing && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* General */}
        <div>
          <h3 className="text-sm font-semibold mb-3">General</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
            {renderField(
              "Team Name",
              team.name,
              <Input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
            )}
            {renderField(
              "Season",
              team.season ?? "—",
              <Input
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                placeholder="e.g. Spring 2026"
              />
            )}
          </div>
        </div>

        {/* Images */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Images</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Team Logo</span>
              {editing ? (
                <ImageUpload
                  bucket="team-images"
                  folder={team.id}
                  currentUrl={team.logo_url}
                  onUpload={async (url) => {
                    const { error } = await supabase
                      .from("teams")
                      .update({ logo_url: url })
                      .eq("id", team.id);
                    if (error) {
                      toast.error(error.message);
                    } else {
                      router.refresh();
                    }
                  }}
                  shape="rounded"
                />
              ) : team.logo_url ? (
                <img
                  src={team.logo_url}
                  alt="Team logo"
                  className="h-20 w-20 rounded-lg object-cover"
                />
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Team Photo</span>
              {editing ? (
                <ImageUpload
                  bucket="team-images"
                  folder={team.id}
                  currentUrl={team.team_photo_url}
                  onUpload={async (url) => {
                    const { error } = await supabase
                      .from("teams")
                      .update({ team_photo_url: url })
                      .eq("id", team.id);
                    if (error) {
                      toast.error(error.message);
                    } else {
                      router.refresh();
                    }
                  }}
                  shape="rounded"
                  width={200}
                  height={120}
                />
              ) : team.team_photo_url ? (
                <img
                  src={team.team_photo_url}
                  alt="Team photo"
                  className="h-30 w-50 rounded-lg object-cover"
                />
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </div>

        {/* Sport & League */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Sport & League</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
            {renderField(
              "Sport",
              formatLabel(team.sport, SPORTS),
              renderSelect(sport, handleSelectChange(setSport), SPORTS, "Select sport")
            )}
            {renderField(
              "League",
              team.league ?? "—",
              <Input
                value={league}
                onChange={(e) => setLeague(e.target.value)}
                placeholder="e.g. AYSO Region 42"
              />
            )}
            {renderField(
              "League Website",
              team.league_url ?? "—",
              <Input
                value={leagueUrl}
                onChange={(e) => setLeagueUrl(e.target.value)}
                type="url"
                placeholder="https://..."
              />
            )}
          </div>
        </div>

        {/* Demographics */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Demographics</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
            {renderField(
              "Team Age",
              formatLabel(team.age_group, AGE_GROUPS),
              renderSelect(ageGroup, handleSelectChange(setAgeGroup), AGE_GROUPS, "Select age group")
            )}
            {renderField(
              "Gender",
              formatLabel(team.gender, GENDERS),
              renderSelect(gender, handleSelectChange(setGender), GENDERS, "Select gender")
            )}
          </div>
        </div>

        {/* Uniforms */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Uniforms</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
            {renderField(
              "Home Uniform",
              team.home_uniform ?? "—",
              <Input
                value={homeUniform}
                onChange={(e) => setHomeUniform(e.target.value)}
                placeholder="e.g. White jersey, blue shorts"
              />
            )}
            {renderField(
              "Away Uniform",
              team.away_uniform ?? "—",
              <Input
                value={awayUniform}
                onChange={(e) => setAwayUniform(e.target.value)}
                placeholder="e.g. Blue jersey, white shorts"
              />
            )}
          </div>
        </div>

        {/* Location */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Location</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
            {renderField(
              "Time Zone",
              team.timezone ?? "—",
              <Select value={timezone} onValueChange={handleSelectChange(setTimezone)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select time zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">
                    <span className="text-muted-foreground">Select time zone</span>
                  </SelectItem>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {renderField(
              "Country",
              countryName(team.country),
              <Select value={country} onValueChange={handleSelectChange(setCountry)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">
                    <span className="text-muted-foreground">Select country</span>
                  </SelectItem>
                  {COMMON_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                  {otherCountries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {renderField(
              "Zip Code",
              team.zip ?? "—",
              <Input
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="e.g. 90210"
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
