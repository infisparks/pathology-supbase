import { supabase } from "@/lib/supabase"

/**
 * Generates a patient ID in the format yyyymmdd-0001, where the sequence resets each new month.
 * Uses the patient_id_sequence table in Supabase to track the last sequence per year+month.
 */
export async function generatePatientIdWithSequence() {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const yearMonth = `${yyyy}${mm}` // e.g., 202406

  // Try to get the current sequence for this year+month
  let { data: seqRow, error } = await supabase
    .from("patient_id_sequence")
    .select("id, last_sequence")
    .eq("year_month", yearMonth)
    .single()

  let sequence = 1

  if (error && error.code === "PGRST116") { // Not found
    // Insert new row for this month
    const { data: insertRow, error: insertErr } = await supabase
      .from("patient_id_sequence")
      .insert({ year_month: yearMonth, last_sequence: 1 })
      .select()
      .single()
    if (insertErr) throw insertErr
    sequence = 1
  } else if (seqRow) {
    // Update the sequence
    const { data: updateRow, error: updateErr } = await supabase
      .from("patient_id_sequence")
      .update({ last_sequence: seqRow.last_sequence + 1, updated_at: new Date().toISOString() })
      .eq("id", seqRow.id)
      .select()
      .single()
    if (updateErr) throw updateErr
    sequence = updateRow.last_sequence
  } else if (error) {
    throw error
  }

  const sequenceStr = String(sequence).padStart(4, "0")
  return `${yyyy}${mm}${dd}-${sequenceStr}`
}
