"use client"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import type {
    PatientData,
    BloodTestData,
    CombinedTestGroup,
    HistoricalTestEntry,
    ComparisonTestSelection,
} from "./types/report"
import { generateReportPdf, generateAiSuggestions } from "./pdf-generator" // Import the new PDF generator utility and AI generator

// -----------------------------
// Helper Functions (Specific to this component's UI logic)
// -----------------------------
const toLocalDateTimeString = (dateInput?: string | Date) => {
    const date = dateInput ? new Date(dateInput) : new Date()
    const offset = date.getTimezoneOffset()
    const adjustedDate = new Date(date.getTime() - offset * 60 * 1000)
    return adjustedDate.toISOString().slice(0, 16)
}

const format12Hour = (isoString: string) => {
    const date = new Date(isoString)
    let hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? "PM" : "AM"
    hours = hours % 12
    hours = hours ? hours : 12
    const minutesStr = minutes < 10 ? "0" + minutes : minutes
    const day = date.getDate().toString().padStart(2, "0")
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const year = date.getFullYear()
    return `${day}/${month}/${year}, ${hours}:${minutesStr} ${ampm}`
}

const formatDMY = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date
    const day = d.getDate().toString().padStart(2, "0")
    const month = (d.getMonth() + 1).toString().padStart(2, "0")
    const year = d.getFullYear()
    let hours = d.getHours()
    const mins = d.getMinutes().toString().padStart(2, "0")
    const ampm = hours >= 12 ? "PM" : "AM"
    hours = hours % 12 || 12
    const hrsStr = hours.toString().padStart(2, "0")
    return `${day}/${month}/${year}, ${hrsStr}:${mins} ${ampm}`
}

const generateId = () => {
    return Math.random().toString(36).substring(2, 9)
}

// Slugify test name for consistent keys
// This function will consistently remove parentheses
const slugifyTestName = (name: string) =>
    name
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[.#$[\]()]/g, "") // Ensure this removes all characters that might cause mismatch

// -----------------------------
// Component
// -----------------------------
export default function DownloadReportPage() {
    return (
        <Suspense fallback={<div>Loading Report...</div>}>
            <DownloadReport />
        </Suspense>
    )
}

function DownloadReport() {
    const router = useRouter()
    const params = useParams()
    const registrationId = params.registrationId as string

    const [patientData, setPatientData] = useState<PatientData | null>(null)
    const [isSending, setIsSending] = useState(false)
    const [selectedTests, setSelectedTests] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [combinedGroups, setCombinedGroups] = useState<CombinedTestGroup[]>([])
    const [showCombineInterface, setShowCombineInterface] = useState(false)
    const [draggedTest, setDraggedTest] = useState<string | null>(null)
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
    const [updateTimeModal, setUpdateTimeModal] = useState<{
        isOpen: boolean
        testKey: string
        currentTime: string
    }>({
        isOpen: false,
        testKey: "",
        currentTime: "",
    })
    const [updateSampleTimeModal, setUpdateSampleTimeModal] = useState<{
        isOpen: boolean
        currentTime: string
    }>({
        isOpen: false,
        currentTime: "",
    })
    const [updateRegistrationTimeModal, setUpdateRegistrationTimeModal] = useState({
        isOpen: false,
        currentTime: "",
    })

    // New states for comparison report
    const [isComparisonMode, setIsComparisonMode] = useState(false)
    const [historicalTestsData, setHistoricalTestsData] = useState<Record<string, HistoricalTestEntry[]>>({}) // Map: testKey -> array of historical entries
    const [comparisonSelections, setComparisonSelections] = useState<Record<string, ComparisonTestSelection>>({}) // Map: testKey -> selection state

    // Fetch patient data and historical data from Supabase
    useEffect(() => {
        if (!registrationId) return

        const fetchAllData = async () => {
            try {
                setLoading(true)
                setError(null)

                console.log("Fetching registration data for ID:", registrationId)

                // First, fetch current registration data with patient details
                const { data: registrationData, error: registrationError } = await supabase
                    .from("registration")
                    .select(
                        `
          *,
          patientdetial (
            id, name, age, gender, patient_id, number, total_day, title, day_type
          )
        `,
                    )
                    .eq("id", registrationId)
                    .single()

                if (registrationError) {
                    console.error("Registration fetch error:", registrationError)
                    throw new Error(`Failed to fetch registration: ${registrationError.message}`)
                }

                if (!registrationData) {
                    throw new Error("Registration not found")
                }

                console.log("Current Registration data fetched:", registrationData)

                // Fetch interpretation data from blood_test table based on test_name
                let parsedBloodtestDataForNames = registrationData.bloodtest_data;
                if (typeof parsedBloodtestDataForNames === "string") {
                    try {
                        parsedBloodtestDataForNames = JSON.parse(parsedBloodtestDataForNames);
                    } catch (e) {
                        console.error("Error parsing bloodtest_data for names (for testNames extraction):", e);
                        parsedBloodtestDataForNames = [];
                    }
                }

                // Use the original test names for the Supabase query
                const originalTestNames = (parsedBloodtestDataForNames || []).map((t: any) => t.testName);
                console.log("Extracted original test names from registration bloodtest_data:", originalTestNames);

                const { data: bloodTests, error: bloodTestError } = await supabase
                    .from("blood_test")
                    .select(`id, test_name, interpretation`)
                    .in('test_name', originalTestNames); // Filter by ORIGINAL test_names present in registration

                if (bloodTestError) {
                    console.error("Blood test interpretation fetch error:", bloodTestError);
                    throw new Error(`Failed to fetch blood tests: ${bloodTestError.message}`);
                }

                console.log("Fetched interpretations from blood_test table (with original names):", bloodTests);

                const testInterpretations: Record<string, string> = {};
                bloodTests.forEach((test) => {
                    // Slugify the test_name from the fetched blood_test data to match expected keys
                    const slug = slugifyTestName(test.test_name);
                    testInterpretations[slug] = test.interpretation || "";
                    console.log(`Mapped interpretation: ${test.test_name} (slug: ${slug}) -> ${test.interpretation}`);
                });

                console.log("Final mapped test interpretations (slugified keys):", testInterpretations);

                let parsedBloodtestDetail = registrationData.bloodtest_detail
                if (typeof parsedBloodtestDetail === "string") {
                    try {
                        parsedBloodtestDetail = JSON.parse(parsedBloodtestDetail)
                    } catch (e) {
                        console.error("Error parsing bloodtest_detail:", e)
                        parsedBloodtestDetail = {}
                    }
                }

                let parsedBloodtestData = registrationData.bloodtest_data
                if (typeof parsedBloodtestData === "string") {
                    try {
                        parsedBloodtestData = JSON.parse(parsedBloodtestData)
                    } catch (e) {
                        console.error("Error parsing bloodtest_data:", e)
                        parsedBloodtestData = []
                    }
                }

                const patientdetial = registrationData.patientdetial as any
                if (!patientdetial) {
                    throw new Error("Patient details not found")
                }

                const mappedPatientData: PatientData = {
                    id: patientdetial.id,
                    name: patientdetial.name,
                    age: patientdetial.age,
                    gender: patientdetial.gender,
                    patientId: patientdetial.patient_id,
                    contact: patientdetial.number,
                    total_day: patientdetial.total_day,
                    day_type: patientdetial.day_type,
                    title: patientdetial.title,
                    hospitalName: registrationData.hospital_name,
                    registration_id: registrationData.id,
                    createdAt: registrationData.registration_time,
                    sampleCollectedAt: registrationData.samplecollected_time,
                    bloodtest_data: parsedBloodtestData || [],
                    bloodtest_detail: parsedBloodtestDetail || {},
                    doctorName: registrationData.doctor_name, // Add this line
                }

                const bloodtestFromDetail: Record<string, BloodTestData> = {}
                if (parsedBloodtestDetail && typeof parsedBloodtestDetail === "object") {
                    // Create a lookup for original test names based on the detail keys
                    // This is essential to map the "incorrect" slug key in bloodtest_detail
                    // back to the correct original test name, then slugify it properly.
                    const detailKeyToOriginalTestName: Record<string, string> = {};
                    (parsedBloodtestData || []).forEach((test: any) => {
                        const detailKey = slugifyTestName(test.testName); // This should produce the clean slug
                        detailKeyToOriginalTestName[detailKey] = test.testName;
                        // Handle the specific 'complete_blood_count_(cbc)' case if it's consistently in your data
                        // This assumes your `bloodtest_detail` is populated with keys like `complete_blood_count_(cbc)`
                        // This is a hack for existing data, the ideal is `slugifyTestName` produces the same everywhere.
                        if (test.testName === "Complete Blood Count (CBC)") {
                            detailKeyToOriginalTestName["complete_blood_count_(cbc)"] = test.testName;
                        }
                    });

                    for (const [testKeyFromDetail, testData] of Object.entries(parsedBloodtestDetail)) {
                        const testInfo = testData as any;
                        const originalTestNameForThisDetail = detailKeyToOriginalTestName[testKeyFromDetail];

                        let interpretationToAssign = "";
                        if (originalTestNameForThisDetail) {
                            const correctSlugForLookup = slugifyTestName(originalTestNameForThisDetail);
                            interpretationToAssign = testInterpretations[correctSlugForLookup] || "";
                        } else {
                            // Fallback if original test name lookup fails (e.g., if bloodtest_data is inconsistent)
                            // Try looking up directly with the detail key after basic slugification
                            interpretationToAssign = testInterpretations[slugifyTestName(testKeyFromDetail.replace(/_/g, " "))] || "";
                        }

                        console.log(`Processing test ${testKeyFromDetail} for patientData:`);
                        console.log(`  - reportedOn: ${testInfo.reportedOn}`);
                        console.log(`  - original test name (derived): ${originalTestNameForThisDetail}`);
                        console.log(`  - interpretation assigned: ${interpretationToAssign}`);

                        bloodtestFromDetail[testKeyFromDetail] = {
                            testId: testKeyFromDetail, // Keep original key for bloodtest_detail structure
                            parameters: testInfo.parameters || [],
                            subheadings: testInfo.subheadings || [],
                            descriptions: testInfo.descriptions || [],
                            reportedOn: testInfo.reportedOn || null,
                            enteredBy: testInfo.enteredBy,
                            type: testInfo,
                            interpretation: interpretationToAssign, // Assign the found interpretation
                        }
                    }
                }

                const finalBloodtestData = hideInvisible({ ...mappedPatientData, bloodtest: bloodtestFromDetail })
                console.log("Final bloodtest data after hideInvisible (including interpretations):", finalBloodtestData);

                setPatientData({ ...mappedPatientData, bloodtest: finalBloodtestData })

                // Fetch historical registrations for the same patient using patientdetial.id
                const { data: historicalRegistrations, error: historicalError } = await supabase
                    .from("registration")
                    .select(
                        `
          id, registration_time, bloodtest_detail, bloodtest_data
        `,
                    )
                    .eq("patient_id", patientdetial.id)
                    .order("registration_time", { ascending: true })

                if (historicalError) {
                    console.error("Historical registrations fetch error:", historicalError)
                    throw new Error(`Failed to fetch historical data: ${historicalError.message}`)
                }

                console.log("Historical registrations fetched:", historicalRegistrations)

                const aggregatedHistoricalData: Record<string, HistoricalTestEntry[]> = {}
                const initialComparisonSelections: Record<string, ComparisonTestSelection> = {}

                historicalRegistrations.forEach((reg: any) => { // Explicitly type reg as any for now
                    let regBloodtestDetail = reg.bloodtest_detail
                    if (typeof regBloodtestDetail === "string") {
                        try {
                            regBloodtestDetail = JSON.parse(regBloodtestDetail)
                        } catch (e) {
                            console.error("Error parsing historical bloodtest_detail:", e)
                            regBloodtestDetail = {}
                        }
                    }

                    let regBloodtestData = reg.bloodtest_data
                    if (typeof regBloodtestData === "string") {
                        try {
                            regBloodtestData = JSON.parse(regBloodtestData)
                        } catch (e) {
                            console.error("Error parsing historical bloodtest_data:", e)
                            regBloodtestData = []
                        }
                    }

                    for (const [testKey, testDetail] of Object.entries(regBloodtestDetail || {})) {
                        const testInfo = testDetail as any
                        const originalTestName =
                            regBloodtestData?.find((t: any) => slugifyTestName(t.testName) === testKey || t.testName === testKey)
                                ?.testName || testKey.replace(/_/g, " ")

                        const reportedOn = testInfo.reportedOn || reg.registration_time // Fallback to registration time

                        if (!aggregatedHistoricalData[testKey]) {
                            aggregatedHistoricalData[testKey] = []
                        }

                        aggregatedHistoricalData[testKey].push({
                            registrationId: reg.id,
                            reportedOn: reportedOn,
                            testKey: testKey,
                            parameters: testInfo.parameters || [],
                        })

                        if (!initialComparisonSelections[testKey]) {
                            initialComparisonSelections[testKey] = {
                                testName: originalTestName,
                                slugifiedTestName: testKey,
                                availableDates: [],
                                selectedDates: [],
                            }
                        }

                        initialComparisonSelections[testKey].availableDates.push({
                            date: new Date(reportedOn).toISOString(), // Use ISO string for consistent comparison
                            registrationId: reg.id,
                            testKey: testKey,
                            reportedOn: reportedOn,
                        })
                    }
                })

                // Sort available dates and pre-select latest N for common tests
                for (const testKey in initialComparisonSelections) {
                    initialComparisonSelections[testKey].availableDates.sort(
                        (a, b) => new Date(a.reportedOn).getTime() - new Date(b.reportedOn).getTime(),
                    )

                    const numToSelect = testKey === "cbc" ? 4 : testKey === "lft" ? 3 : 0 // Default N reports
                    initialComparisonSelections[testKey].selectedDates = initialComparisonSelections[testKey].availableDates
                        .slice(-numToSelect)
                        .map((d) => d.date)
                }

                setHistoricalTestsData(aggregatedHistoricalData)
                setComparisonSelections(initialComparisonSelections)
            } catch (error) {
                console.error("Error fetching all data:", error)
                setError(error instanceof Error ? error.message : "Unknown error occurred")
            } finally {
                setLoading(false)
            }
        }

        fetchAllData()
    }, [registrationId])

    // Initialize selected tests
    useEffect(() => {
        if (patientData?.bloodtest) {
            setSelectedTests(Object.keys(patientData.bloodtest))
        }
    }, [patientData])

    // Hide invisible parameters
    const hideInvisible = (d: PatientData): Record<string, BloodTestData> => {
        const out: Record<string, BloodTestData> = {}
        if (!d.bloodtest) return out

        for (const k in d.bloodtest) {
            const t = d.bloodtest[k]
            if (t.type === "outsource") continue

            const keptParams = Array.isArray(t.parameters)
                ? t.parameters
                    .filter((p) => p.visibility !== "hidden")
                    .map((p) => ({
                        ...p,
                        subparameters: Array.isArray(p.subparameters)
                            ? p.subparameters.filter((sp) => sp.visibility !== "hidden")
                            : [],
                    }))
                : []

            out[k] = {
                ...t,
                parameters: keptParams,
                subheadings: t.subheadings,
                reportedOn: t.reportedOn,
                descriptions: t.descriptions,
                interpretation: t.interpretation, // Make sure interpretation is carried over
            }
        }
        return out
    }

    // Update reportedOn time for a test
    const updateReportedOnTime = (testKey: string) => {
        const test = patientData?.bloodtest_detail?.[testKey]
        if (!test) return

        console.log(`Updating time for test ${testKey}:`, {
            testData: test,
            reportedOn: test.reportedOn,
            bloodtestDetail: patientData?.bloodtest_detail?.[testKey],
            bloodtestData: patientData?.bloodtest?.[testKey]
        })

        const currentTime = test.reportedOn && test.reportedOn !== null ? toLocalDateTimeString(test.reportedOn) : toLocalDateTimeString()

        setUpdateTimeModal({
            isOpen: true,
            testKey,
            currentTime,
        })
    }

    // Save updated reportedOn time
    const saveUpdatedTime = async () => {
        if (!patientData || !updateTimeModal.testKey) return

        try {
            const newReportedOn = new Date(updateTimeModal.currentTime).toISOString()

            const updatedBloodtestDetail = {
                ...patientData.bloodtest_detail,
                [updateTimeModal.testKey]: {
                    ...patientData.bloodtest_detail[updateTimeModal.testKey] as BloodTestData, // Cast to BloodTestData
                    reportedOn: newReportedOn,
                },
            }

            const { error } = await supabase
                .from("registration")
                .update({ bloodtest_detail: updatedBloodtestDetail })
                .eq("id", patientData.registration_id)

            if (error) throw error

            setPatientData((prev: PatientData | null) => { // Explicitly type prev
                if (!prev) return prev
                return {
                    ...prev,
                    bloodtest_detail: updatedBloodtestDetail,
                    bloodtest: prev.bloodtest
                        ? {
                            ...prev.bloodtest,
                            [updateTimeModal.testKey]: {
                                ...prev.bloodtest[updateTimeModal.testKey],
                                reportedOn: newReportedOn,
                            },
                        }
                        : undefined,
                }
            })

            setUpdateTimeModal((prev: typeof updateTimeModal) => ({ ...prev, isOpen: false })) // Explicitly type prev
            alert("Report time updated successfully!")
        } catch (error) {
            console.error("Error updating report time:", error)
            alert("Failed to update report time.")
        }
    }

    // Open modal to update sampleCollectedAt time
    const updateSampleCollectedTime = () => {
        const currentTime = patientData?.sampleCollectedAt
            ? toLocalDateTimeString(patientData.sampleCollectedAt)
            : toLocalDateTimeString()

        setUpdateSampleTimeModal({
            isOpen: true,
            currentTime,
        })
    }

    // Open modal to update createdAt (Registration On)
    const updateRegistrationTime = () => {
        const currentTime = patientData?.createdAt ? toLocalDateTimeString(patientData.createdAt) : toLocalDateTimeString()

        setUpdateRegistrationTimeModal({
            isOpen: true, // Changed to true to open the modal
            currentTime,
        })
    }

    // Save updated sampleCollectedAt time
    const saveUpdatedSampleTime = async () => {
        if (!patientData) return

        try {
            const newSampleAt = new Date(updateSampleTimeModal.currentTime).toISOString()

            const { error } = await supabase
                .from("registration")
                .update({ samplecollected_time: newSampleAt })
                .eq("id", patientData.registration_id)

            if (error) throw error

            setPatientData((prev: PatientData | null) => (prev ? { ...prev, sampleCollectedAt: newSampleAt } : prev)) // Explicitly type prev
            setUpdateSampleTimeModal((prev: typeof updateSampleTimeModal) => ({ ...prev, isOpen: false })) // Explicitly type prev
            alert("Sample collected time updated successfully!")
        } catch (error) {
            console.error("Error updating sample collected time:", error)
            alert("Failed to update sample collected time.")
        }
    }

    // Save updated registration time (createdAt)
    const saveUpdatedRegistrationTime = async () => {
        if (!patientData) return

        try {
            const newCreatedAt = new Date(updateRegistrationTimeModal.currentTime).toISOString()

            const { error } = await supabase
                .from("registration")
                .update({ registration_time: newCreatedAt })
                .eq("id", patientData.registration_id)

            if (error) throw error

            setPatientData((prev: PatientData | null) => (prev ? { ...prev, createdAt: newCreatedAt } : prev)) // Explicitly type prev
            setUpdateRegistrationTimeModal((prev: typeof updateRegistrationTimeModal) => ({ ...prev, isOpen: false })) // Explicitly type prev
            alert("Registration time updated successfully!")
        } catch (error) {
            console.error("Error updating registration time:", error)
            alert("Failed to update registration time.")
        }
    }

    // Combined test group functions
    const addCombinedGroup = () => {
        const newGroup: CombinedTestGroup = {
            id: generateId(),
            name: `Combined Group ${combinedGroups.length + 1}`,
            tests: [],
        }
        setCombinedGroups([...combinedGroups, newGroup])
    }

    const removeCombinedGroup = (groupId: string) => {
        setCombinedGroups(combinedGroups.filter((group: CombinedTestGroup) => group.id === groupId)) // Explicitly type group
    }

    const updateGroupName = (groupId: string, newName: string) => {
        setCombinedGroups(combinedGroups.map((group: CombinedTestGroup) => (group.id === groupId ? { ...group, name: newName } : group))) // Explicitly type group
    }

    const handleDragStart = (testKey: string) => {
        setDraggedTest(testKey)
    }

    const handleDragOver = (e: React.DragEvent, groupId: string) => {
        e.preventDefault()
        setActiveGroupId(groupId)
    }

    const handleDragLeave = () => {
        setActiveGroupId(null)
    }

    const handleDrop = (e: React.DragEvent, groupId: string) => {
        e.preventDefault()
        if (!draggedTest) return

        const updatedGroups = combinedGroups.map((group: CombinedTestGroup) => { // Explicitly type group
            if (group.id === groupId) {
                if (!group.tests.includes(draggedTest)) {
                    return {
                        ...group,
                        tests: [...group.tests, draggedTest],
                    }
                }
            }
            return group
        })

        setCombinedGroups(updatedGroups)
        setDraggedTest(null)
        setActiveGroupId(null)
    }

    const removeTestFromGroup = (groupId: string, testKey: string) => {
        setCombinedGroups(
            combinedGroups.map((group: CombinedTestGroup) => // Explicitly type group
                group.id === groupId ? { ...group, tests: group.tests.filter((t: string) => t !== testKey) } : group, // Explicitly type t
            ),
        )
    }

    // Download PDF report
    const downloadPDF = async (reportType: "normal" | "comparison" | "combined", includeLetterhead: boolean) => {
        if (!patientData) return

        setIsSending(true)
        try {
            console.log("Sending data to PDF generator:", {
                patientData: patientData,
                bloodtest: patientData.bloodtest,
                selectedTests: selectedTests,
                includeLetterhead: includeLetterhead
            })

            // Always skip cover for all download buttons as per new requirement
            const skipCoverForDownload = true;

            const blob = await generateReportPdf(
                patientData,
                selectedTests,
                combinedGroups,
                historicalTestsData,
                comparisonSelections,
                reportType,
                includeLetterhead, // Pass the includeLetterhead flag
                skipCoverForDownload, // Now always true for downloads
                undefined, // No AI suggestions for direct download
                false, // Do not include AI suggestions page
            )

            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `report-${patientData.name.replace(/\s+/g, "-").toLowerCase()}-${reportType}${includeLetterhead ? "" : "-no-letterhead"}.pdf`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        } catch (error) {
            console.error("Error generating or downloading PDF:", error)
            alert("Failed to generate PDF report.")
        } finally {
            setIsSending(false)
        }
    }

    const preview = async (reportType: "normal" | "comparison" | "combined", withLetter: boolean) => {
        if (!patientData) return

        try {
            const blob = await generateReportPdf(
                patientData,
                selectedTests,
                combinedGroups,
                historicalTestsData,
                comparisonSelections,
                reportType,
                withLetter,
                true, // Always skip cover for preview
                undefined, // No AI suggestions for preview
                false, // Do not include AI suggestions page
            )

            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            // Set the download attribute to suggest a filename if the user clicks download in the preview tab
            // This is the primary way to influence the downloaded file name when using a Blob URL for preview.
            a.download = `report-${patientData.name.replace(/\s+/g, "-").toLowerCase()}-${reportType}.pdf`
            // Open the URL in a new tab
            const newWindow = window.open(url, "_blank");
            // Revoke the object URL after a delay (e.g., 10 seconds)
            // This is good practice to release memory, but still allows the user to download
            // if they quickly open the new tab and initiate a download.
            // Note: The URL in the address bar will still be a blob: UUID, this cannot be changed.
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 10_000); // 10 seconds
        } catch (err) {
            console.error("Preview error:", err)
            alert("Failed to generate preview.")
        }
    }

    const sendWhatsApp = async () => {
        if (!patientData) return

        try {
            setIsSending(true)

            // Generate AI suggestions
            const aiSuggestions = await generateAiSuggestions(patientData, patientData.bloodtest || {})

            const blob = await generateReportPdf(
                patientData,
                selectedTests,
                combinedGroups,
                historicalTestsData,
                comparisonSelections,
                "normal", // Default to normal report for WhatsApp
                true, // Include letterhead for WhatsApp
                false, // Do not skip cover for WhatsApp (so cover is page 1)
                aiSuggestions, // Pass AI suggestions
                true, // Include AI suggestions page for WhatsApp (this will be page 2)
            )

            const filename = `reports/${patientData.registration_id}_${Date.now()}.pdf`

            const { data: uploadData, error: uploadError } = await supabase.storage.from("reports").upload(filename, blob, {
                cacheControl: "3600",
                upsert: false,
                contentType: "application/pdf",
            })

            if (uploadError) {
                console.error("Supabase upload error:", uploadError)
                throw new Error(`Failed to upload file to Supabase: ${uploadError.message}`)
            }

            const { data: publicUrlData } = supabase.storage.from("reports").getPublicUrl(filename)
            const url = publicUrlData.publicUrl

            const payload = {
                token: "99583991573",
                number: "91" + patientData.contact,
                imageUrl: url,
                caption: `Dear ${patientData.name},\n\nYour blood test report is now available:\n${url}\n\nRegards,\nYour Lab Team`,
            }

            const res = await fetch("https://a.infispark.in/send-image-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ message: "Unknown error" }))
                console.error("WhatsApp API Error:", errorData)
                alert(`Failed to send via WhatsApp. Status: ${res.status}`)
            } else {
                alert("Report sent on WhatsApp!")
            }
        } catch (e) {
            console.error("Error sending WhatsApp message:", e)
            alert("Error sending WhatsApp message.")
        } finally {
            setIsSending(false)
        }
    }

    // Loading state
    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-lg text-gray-600">Loading patient data...</p>
                </div>
            </div>
        )
    }

    // Error state
    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
                    <div className="text-red-500 mb-4">
                        <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                            />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-4">Error Loading Data</h2>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition duration-150 ease-in-out"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        )
    }

    // No patient data
    if (!patientData) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
                    <h2 className="text-2xl font-bold text-gray-800 mb-4">No Data Found</h2>
                    <p className="text-gray-600">No patient data found for this registration ID.</p>
                </div>
            </div>
        )
    }

    // Main UI
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="max-w-4xl w-full space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Report Actions Card */}
                    <div className="bg-white rounded-xl shadow-lg p-8 space-y-4 col-span-1 md:col-span-2">
                        <h2 className="text-3xl font-bold text-center text-gray-800 mb-6">Report Ready</h2>

                        {/* Patient Info Display */}
                        <div className="p-4 bg-blue-50 rounded-lg mb-4">
                            <h3 className="text-lg font-semibold text-gray-800 mb-2">Patient Information</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="font-medium">Name:</span> {patientData.title ? `${patientData.title} ` : ""}
                                    {patientData.name}
                                </div>
                                <div>
                                    <span className="font-medium">Patient ID:</span>{" "}
                                    {patientData.patientId && patientData.registration_id
                                        ? `${patientData.patientId}-${patientData.registration_id}`
                                        : patientData.patientId || patientData.registration_id || "-"}
                                </div>
                                <div>
                                    <span className="font-medium">Age/Gender:</span> {patientData.age}{" "}
                                    {patientData.total_day ? "Years" : "Days"} / {patientData.gender}
                                </div>
                                <div>
                                    <span className="font-medium">Contact:</span>{" "}
                                    {patientData.contact
                                        ? patientData.contact
                                        : <span className="text-gray-400 italic">Not provided</span>}
                                </div>
                            </div>
                        </div>

                        {/* Registration On Display and Update Button */}
                        <div className="p-4 bg-gray-100 rounded-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-700">Registration On:</p>
                                    <p className="text-sm text-gray-600">
                                        {patientData.createdAt ? format12Hour(patientData.createdAt) : "Not set"}
                                    </p>
                                </div>
                                <button
                                    onClick={updateRegistrationTime}
                                    className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4 mr-1"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                        />
                                    </svg>
                                    Update Time
                                </button>
                            </div>
                        </div>

                        {/* Sample Collected On Display and Update Button */}
                        <div className="p-4 bg-gray-100 rounded-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-700">Sample Collected On:</p>
                                    <p className="text-sm text-gray-600">
                                        {patientData.sampleCollectedAt ? format12Hour(patientData.sampleCollectedAt) : "Not set"}
                                    </p>
                                </div>
                                <button
                                    onClick={updateSampleCollectedTime}
                                    className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4 mr-1"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                        />
                                    </svg>
                                    Update Time
                                </button>
                            </div>
                        </div>

                        {/* Comparison Report Checkbox */}
                        <div className="p-4 bg-gray-100 rounded-lg">
                            <label className="flex items-center space-x-3">
                                <input
                                    type="checkbox"
                                    className="form-checkbox h-5 w-5 text-indigo-600 rounded"
                                    checked={isComparisonMode}
                                    onChange={(e) => setIsComparisonMode(e.target.checked)}
                                />
                                <span className="text-gray-700 font-medium">Generate Comparison Report</span>
                            </label>
                        </div>

                        {/* Download Buttons */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4"> {/* Changed to 4 columns */}
                            <button
                                onClick={() => downloadPDF("normal", true)} // Include letterhead, skipCover true (all downloads)
                                className="w-full flex items-center justify-center space-x-3 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium transition duration-150 ease-in-out"
                                disabled={isSending}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                    />
                                </svg>
                                <span>Download Report Letterhead</span>
                            </button>

                            <button
                                onClick={() => downloadPDF("normal", false)} // Exclude letterhead, skipCover true (all downloads)
                                className="w-full flex items-center justify-center space-x-3 bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium transition duration-150 ease-in-out"
                                disabled={isSending}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                    />
                                </svg>
                                <span>Download Report No Letterhead</span>
                            </button>

                            <button
                                onClick={() => downloadPDF("combined", true)} // skipCover true (all downloads)
                                className="w-full flex items-center justify-center space-x-3 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-xl font-medium transition duration-150 ease-in-out"
                                disabled={isSending}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2m-6 0h.01M12 16l2 2m0 0l2-2m-2 2V9"
                                    />
                                </svg>
                                <span>Download Combined</span>
                            </button>

                            <button
                                onClick={() => downloadPDF("comparison", true)} // skipCover true (all downloads)
                                className="w-full flex items-center justify-center space-x-3 bg-sky-600 hover:bg-sky-700 text-white px-6 py-3 rounded-xl font-medium transition duration-150 ease-in-out"
                                disabled={isSending}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                                    />
                                </svg>
                                <span>Download Comparison</span>
                            </button>
                        </div>

                        {/* Preview Buttons */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <button
                                onClick={() => preview(isComparisonMode ? "comparison" : "normal", true)}
                                className="w-full flex items-center justify-center space-x-3 bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-xl font-medium transition duration-150 ease-in-out"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                    />
                                </svg>
                                <span>Preview (Letterhead)</span>
                            </button>

                            <button
                                onClick={() => preview(isComparisonMode ? "comparison" : "normal", false)}
                                className="w-full flex items-center justify-center space-x-3 bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-xl font-medium transition duration-150 ease-in-out"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                    />
                                </svg>
                                <span>Preview (No letterhead)</span>
                            </button>
                        </div>

                        {/* WhatsApp Button */}
                        <>
                            <button
                                onClick={sendWhatsApp}
                                disabled={isSending}
                                className={`w-full flex items-center justify-center space-x-3 px-6 py-3 rounded-xl font-medium transition duration-150 ease-in-out ${isSending ? "bg-gray-400 cursor-not-allowed" : "bg-[#25D366] hover:bg-[#128C7E] text-white"
                                    }`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.709.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c0-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884" />
                                </svg>
                                <span>{isSending ? "Sending…" : "Send via WhatsApp"}</span>
                            </button>

                            {/* Loading Overlay Popup */}
                            {isSending && (
                                <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black bg-opacity-40">
                                    <div className="bg-white rounded-xl shadow-xl p-8 flex flex-col items-center">
                                        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-indigo-600 mx-auto"></div>
                                        <div className="mt-4 text-lg font-semibold text-gray-700">Sending Report via WhatsApp…</div>
                                    </div>
                                </div>
                            )}
                        </>
                    </div>

                    {/* Test Selection Card */}
                    {!isComparisonMode && (
                        <div className="bg-white rounded-xl shadow-lg p-8 space-y-4">
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">Select Tests to Include</h2>
                            <div className="space-y-3">
                                {patientData.bloodtest &&
                                    Object.entries(patientData.bloodtest).map(([testKey, testData]) => {
                                        console.log(`Displaying test ${testKey}:`, {
                                            testData: testData,
                                            reportedOn: (testData as BloodTestData).reportedOn, // Cast testData
                                            bloodtestDetail: patientData?.bloodtest_detail?.[testKey]
                                        })

                                        return (
                                            <div key={testKey} className="border rounded-lg p-3 bg-gray-50">
                                                <div className="flex items-center justify-between mb-2">
                                                    <label className="flex items-center space-x-3">
                                                        <input
                                                            type="checkbox"
                                                            className="form-checkbox h-5 w-5 text-indigo-600 rounded"
                                                            checked={selectedTests.includes(testKey)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedTests([...selectedTests, testKey])
                                                                } else {
                                                                    setSelectedTests(selectedTests.filter((key: string) => key !== testKey)) // Explicitly type key
                                                                }
                                                            }}
                                                        />
                                                        <span className="text-gray-700 font-medium">{testKey.replace(/_/g, " ")}</span>
                                                    </label>
                                                    <button
                                                        onClick={() => updateReportedOnTime(testKey)}
                                                        className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                                                    >
                                                        <svg
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            className="h-4 w-4 mr-1"
                                                            fill="none"
                                                            viewBox="0 0 24 24"
                                                            stroke="currentColor"
                                                        >
                                                            <path
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                strokeWidth={2}
                                                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                                            />
                                                        </svg>
                                                        Update Time
                                                    </button>
                                                </div>
                                                <div className="ml-8 text-sm text-gray-600">
                                                    <span className="font-medium">Reported On:</span>{" "}
                                                    {(testData as BloodTestData).reportedOn && (testData as BloodTestData).reportedOn !== null ? ( // Cast testData
                                                        <span>
                                                            {format12Hour((testData as BloodTestData).reportedOn as string)} {/* Cast testData and reportedOn */}
                                                            <span className="text-xs text-gray-400 ml-2">
                                                                (Raw: {(testData as BloodTestData).reportedOn}) {/* Cast testData */}
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-orange-600 italic">Not set</span>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                            </div>
                        </div>
                    )}

                    {/* Comparison Report Test and Date Selection Card */}
                    {isComparisonMode && (
                        <div className="bg-white rounded-xl shadow-lg p-8 space-y-4 col-span-1 md:col-span-2">
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">Select Tests and Dates for Comparison</h2>
                            <div className="space-y-4">
                                {Object.values(comparisonSelections).map((selection: ComparisonTestSelection) => ( // Explicitly type selection
                                    <div key={selection.slugifiedTestName} className="border rounded-lg p-4">
                                        <h3 className="text-lg font-semibold text-gray-800 mb-2">
                                            {selection.testName} ({selection.availableDates.length} reports available)
                                        </h3>
                                        <div className="flex flex-wrap gap-2">
                                            {selection.availableDates.map((dateEntry: { date: string; reportedOn: string; }) => ( // Explicitly type dateEntry
                                                <label
                                                    key={dateEntry.date}
                                                    className="flex items-center space-x-2 bg-gray-100 px-3 py-1 rounded-full text-sm"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="form-checkbox h-4 w-4 text-indigo-600 rounded"
                                                        checked={selection.selectedDates.includes(dateEntry.date)}
                                                        onChange={(e) => {
                                                            setComparisonSelections((prev: Record<string, ComparisonTestSelection>) => { // Explicitly type prev
                                                                const newSelectedDates = e.target.checked
                                                                    ? [...prev[selection.slugifiedTestName].selectedDates, dateEntry.date]
                                                                    : prev[selection.slugifiedTestName].selectedDates.filter((d: string) => d !== dateEntry.date) // Explicitly type d

                                                                return {
                                                                    ...prev,
                                                                    [selection.slugifiedTestName]: {
                                                                        ...prev[selection.slugifiedTestName],
                                                                        selectedDates: newSelectedDates,
                                                                    },
                                                                }
                                                            })
                                                        }}
                                                    />
                                                    <span className="text-gray-700">
                                                        {new Date(dateEntry.reportedOn).toLocaleDateString("en-GB", {
                                                            day: "2-digit",
                                                            month: "2-digit",
                                                            year: "numeric"
                                                        })}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Combined Test Groups Card */}
                    {!isComparisonMode && (
                        <div className="bg-white rounded-xl shadow-lg p-8 space-y-4">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-2xl font-bold text-gray-800">Combine Tests</h2>
                                <button
                                    onClick={() => setShowCombineInterface(!showCombineInterface)}
                                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl transition duration-150 ease-in-out"
                                >
                                    {showCombineInterface ? "Hide" : "Show"} Interface
                                </button>
                            </div>

                            {showCombineInterface && (
                                <>
                                    <div className="space-y-4">
                                        {combinedGroups.map((group: CombinedTestGroup) => ( // Explicitly type group
                                            <div
                                                key={group.id}
                                                className={`border-2 rounded-xl p-4 ${activeGroupId === group.id ? "border-blue-500" : "border-gray-300"
                                                    }`}
                                                onDragOver={(e) => handleDragOver(e, group.id)}
                                                onDragLeave={handleDragLeave}
                                                onDrop={(e) => handleDrop(e, group.id)}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <input
                                                        type="text"
                                                        value={group.name}
                                                        onChange={(e) => updateGroupName(group.id, e.target.value)}
                                                        className="w-1/2 px-3 py-2 border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                    />
                                                    <button
                                                        onClick={() => removeCombinedGroup(group.id)}
                                                        className="px-3 py-1 bg-red-500 hover:bg-red-700 text-white rounded-xl transition duration-150 ease-in-out"
                                                    >
                                                        Remove Group
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {group.tests.map((testKey: string) => ( // Explicitly type testKey
                                                        <div
                                                            key={testKey}
                                                            draggable="true"
                                                            onDragStart={() => handleDragStart(testKey)}
                                                            className="bg-yellow-100 px-3 py-1 rounded-full text-sm cursor-grab"
                                                        >
                                                            {testKey.replace(/_/g, " ")}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <button
                                        onClick={addCombinedGroup}
                                        className="px-4 py-2 bg-green-500 hover:bg-green-700 text-white rounded-xl transition duration-150 ease-in-out"
                                    >
                                        Add New Group
                                    </button>

                                    <div className="border-t pt-4">
                                        <h3 className="text-lg font-semibold text-gray-700 mb-2">Drag Tests to Groups</h3>
                                        <div className="flex flex-wrap gap-2">
                                            {patientData.bloodtest &&
                                                Object.keys(patientData.bloodtest).map((testKey: string) => ( // Explicitly type testKey
                                                    <div
                                                        key={testKey}
                                                        draggable="true"
                                                        onDragStart={() => handleDragStart(testKey)}
                                                        className="bg-yellow-100 px-3 py-1 rounded-full text-sm cursor-grab"
                                                    >
                                                        {testKey.replace(/_/g, " ")}
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Update Time Modal */}
            {updateTimeModal.isOpen && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                    <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
                        <div className="mt-3 text-center">
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Update Report Time</h3>
                            <div className="mt-2 px-7 py-3">
                                <input
                                    type="datetime-local"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    value={updateTimeModal.currentTime}
                                    onChange={(e) => setUpdateTimeModal({ ...updateTimeModal, currentTime: e.target.value })}
                                />
                            </div>
                            <div className="items-center px-4 py-3">
                                <button
                                    className="px-4 py-2 bg-green-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-300"
                                    onClick={saveUpdatedTime}
                                >
                                    Save
                                </button>
                                <button
                                    className="px-4 py-2 bg-red-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 mt-2"
                                    onClick={() => setUpdateTimeModal((prev: typeof updateTimeModal) => ({ ...prev, isOpen: false }))}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Update Sample Time Modal */}
            {updateSampleTimeModal.isOpen && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                    <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
                        <div className="mt-3 text-center">
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Update Sample Collected Time</h3>
                            <div className="mt-2 px-7 py-3">
                                <input
                                    type="datetime-local"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    value={updateSampleTimeModal.currentTime}
                                    onChange={(e) => setUpdateSampleTimeModal({ ...updateSampleTimeModal, currentTime: e.target.value })}
                                />
                            </div>
                            <div className="items-center px-4 py-3">
                                <button
                                    className="px-4 py-2 bg-green-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-300"
                                    onClick={saveUpdatedSampleTime}
                                >
                                    Save
                                </button>
                                <button
                                    className="px-4 py-2 bg-red-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 mt-2"
                                    onClick={() => setUpdateSampleTimeModal((prev: typeof updateSampleTimeModal) => ({ ...prev, isOpen: false }))}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Update Registration Time Modal */}
            {updateRegistrationTimeModal.isOpen && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                    <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
                        <div className="mt-3 text-center">
                            <h3 className="text-lg leading-6 font-medium text-gray-900">Update Registration Time</h3>
                            <div className="mt-2 px-7 py-3">
                                <input
                                    type="datetime-local"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    value={updateRegistrationTimeModal.currentTime}
                                    onChange={(e) =>
                                        setUpdateRegistrationTimeModal((prev: typeof updateRegistrationTimeModal) => ({ ...prev, currentTime: e.target.value })) // Explicitly type prev
                                    }
                                />
                            </div>
                            <div className="items-center px-4 py-3">
                                <button
                                    className="px-4 py-2 bg-green-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-300"
                                    onClick={saveUpdatedRegistrationTime}
                                >
                                    Save
                                </button>
                                <button
                                    className="px-4 py-2 bg-red-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 mt-2"
                                    onClick={() => setUpdateRegistrationTimeModal((prev: typeof updateRegistrationTimeModal) => ({ ...prev, isOpen: false }))}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
