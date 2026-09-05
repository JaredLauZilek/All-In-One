// Training → Races: the competition calendar the plan engine aims at.
// The earliest upcoming race with a date is the active goal; everything
// else queues behind it.
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Plus, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, CardHeader, Input, Select, Textarea, Modal, EmptyState, StatusBadge, cn } from "../../components/ui";
import { type TrRace, RACE_TYPES, daysUntil } from "./lib";

export default function Races() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: races } = useQuery({
    queryKey: ["tr-races"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tr_races").select("*")
        .order("race_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as TrRace[];
    },
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tr-races"] });
    qc.invalidateQueries({ queryKey: ["tr-week"] });
  };

  const patch = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<TrRace> & { id: string }) => {
      const { error } = await supabase.from("tr_races").update(fields).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tr_races").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const upcoming = (races ?? []).filter((r) => r.status === "upcoming");
  const past = (races ?? []).filter((r) => r.status !== "upcoming");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader
          title="Upcoming races"
          subtitle="The earliest dated race is the active goal — weekly plans periodize toward it"
          action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add race</Button>}
        />
        {upcoming.length === 0 ? (
          <EmptyState icon={<Trophy className="h-5 w-5" />} title="No races yet"
            subtitle="Add the Hyrox / half / full you've signed up for and the plan engine takes it from there." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {upcoming.map((r, i) => (
              <RaceRow key={r.id} r={r} isActive={i === 0}
                onDate={(d) => patch.mutate({ id: r.id, race_date: d || null })}
                onDone={() => patch.mutate({ id: r.id, status: "done" })}
                onDelete={() => { if (confirm(`Delete ${r.name}?`)) remove.mutate(r.id); }}
              />
            ))}
          </ul>
        )}
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader title="Done" subtitle="Race history" />
          <ul className="divide-y divide-slate-100">
            {past.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="text-sm font-semibold text-slate-500">{r.name}</span>
                <span className="text-xs text-slate-400">{RACE_TYPES[r.race_type]} · {r.race_date ?? "—"}</span>
                {r.result && <span className="font-mono text-xs text-emerald-600">{r.result}</span>}
                <button onClick={() => { if (confirm(`Delete ${r.name}?`)) remove.mutate(r.id); }}
                  className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && <AddRaceModal onClose={() => { setAdding(false); invalidate(); }} />}
    </div>
  );
}

function RaceRow({ r, isActive, onDate, onDone, onDelete }: {
  r: TrRace; isActive: boolean;
  onDate: (d: string) => void; onDone: () => void; onDelete: () => void;
}) {
  const dTo = r.race_date ? daysUntil(r.race_date) : null;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={cn("text-sm font-bold", isActive ? "text-slate-900" : "text-slate-600")}>{r.name}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
          {RACE_TYPES[r.race_type] ?? r.race_type}
        </span>
        {isActive && <StatusBadge status="ENTRY" dot={false} />}
        {dTo != null && (
          <span className={cn("font-mono text-xs", dTo <= 14 ? "text-red-600 font-semibold" : "text-slate-400")}>
            {dTo} days out
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={onDone}>Mark done</Button>
          <button onClick={onDelete} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          Race date
          <input
            type="date"
            defaultValue={r.race_date ?? ""}
            onBlur={(e) => { if (e.target.value !== (r.race_date ?? "")) onDate(e.target.value); }}
            className="rounded-lg border border-slate-300 bg-surface px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        {r.location && <span className="text-xs text-slate-400">{r.location}</span>}
      </div>
      {r.notes && <p className="mt-1.5 text-xs text-slate-400">{r.notes}</p>}
    </li>
  );
}

function AddRaceModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("hyrox");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tr_races").insert({
        name: name.trim(), race_type: type, race_date: date || null,
        location: location.trim() || null, notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: onClose,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) add.mutate();
  }
  return (
    <Modal open onClose={onClose} title="Add a race">
      <form onSubmit={submit} className="space-y-3">
        <Input placeholder="Name — e.g. Hyrox Singapore" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(RACE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="font-mono" />
        <Input placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
        <Textarea rows={2} placeholder="Notes — goal time, qualifying standard…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button type="submit" loading={add.isPending} disabled={!name.trim()} className="w-full">Add race</Button>
      </form>
    </Modal>
  );
}
