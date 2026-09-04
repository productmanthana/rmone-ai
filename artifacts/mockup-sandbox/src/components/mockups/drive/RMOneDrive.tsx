import { useState, useRef } from "react";

const FOLDERS = [
  { id: "all", label: "All Files", icon: "🗂️" },
  { id: "templates", label: "Templates", icon: "📋" },
  { id: "projects", label: "Projects", icon: "🏗️" },
  { id: "reports", label: "Reports", icon: "📊" },
  { id: "contracts", label: "Contracts", icon: "📝" },
  { id: "archive", label: "Archive", icon: "📦" },
];

type FileItem = {
  id: number;
  name: string;
  folder: string;
  type: "xlsx" | "pdf" | "docx" | "csv";
  size: string;
  updated: string;
  uploadedBy: string;
  isTemplate?: boolean;
};

const FILES: FileItem[] = [
  { id: 1, name: "Projects Import Template.xlsx", folder: "templates", type: "xlsx", size: "42 KB", updated: "Jun 20, 2025", uploadedBy: "Admin", isTemplate: true },
  { id: 2, name: "Team Assignments Template.xlsx", folder: "templates", type: "xlsx", size: "38 KB", updated: "Jun 20, 2025", uploadedBy: "Admin", isTemplate: true },
  { id: 3, name: "Schedule Template.xlsx", folder: "templates", type: "xlsx", size: "29 KB", updated: "Jun 20, 2025", uploadedBy: "Admin", isTemplate: true },
  { id: 4, name: "Q2 2025 Pipeline Report.pdf", folder: "reports", type: "pdf", size: "1.2 MB", updated: "Jun 28, 2025", uploadedBy: "Lisa Chen" },
  { id: 5, name: "Metro Rail — Project Data.xlsx", folder: "projects", type: "xlsx", size: "185 KB", updated: "Jun 25, 2025", uploadedBy: "Tom Williams" },
  { id: 6, name: "Harborview Contract.pdf", folder: "contracts", type: "pdf", size: "3.4 MB", updated: "May 14, 2025", uploadedBy: "James Norton" },
  { id: 7, name: "Staff Roster June 2025.xlsx", folder: "projects", type: "xlsx", size: "94 KB", updated: "Jun 15, 2025", uploadedBy: "Priya Sharma" },
  { id: 8, name: "Annual Utilisation Report.pdf", folder: "reports", type: "pdf", size: "2.1 MB", updated: "Jan 10, 2025", uploadedBy: "Admin" },
  { id: 9, name: "Rate Card 2025.xlsx", folder: "contracts", type: "xlsx", size: "56 KB", updated: "Mar 1, 2025", uploadedBy: "Admin" },
  { id: 10, name: "Archive — 2024 Projects.csv", folder: "archive", type: "csv", size: "340 KB", updated: "Dec 31, 2024", uploadedBy: "Admin" },
];

const TYPE_COLORS: Record<string, string> = {
  xlsx: "bg-green-100 text-green-700",
  pdf: "bg-red-100 text-red-700",
  docx: "bg-blue-100 text-blue-700",
  csv: "bg-yellow-100 text-yellow-700",
};
const TYPE_ICONS: Record<string, string> = {
  xlsx: "📗",
  pdf: "📕",
  docx: "📘",
  csv: "📄",
};

function FileRow({ file, onDownload }: { file: FileItem; onDownload: (name: string) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      className={`border-b border-gray-100 transition-colors ${hovered ? "bg-blue-50" : "bg-white"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <td className="py-3 px-4 flex items-center gap-3 min-w-0">
        <span className="text-xl shrink-0">{TYPE_ICONS[file.type]}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 truncate">{file.name}</div>
          {file.isTemplate && (
            <span className="text-xs text-indigo-500 font-medium">Template</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${TYPE_COLORS[file.type]}`}>
          {file.type}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-gray-500">{file.size}</td>
      <td className="py-3 px-4 text-xs text-gray-500">{file.updated}</td>
      <td className="py-3 px-4 text-xs text-gray-500">{file.uploadedBy}</td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDownload(file.name)}
            className="flex items-center gap-1 px-3 py-1 text-xs text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50 transition font-medium"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>
          {file.isTemplate && (
            <button className="flex items-center gap-1 px-3 py-1 text-xs text-green-600 border border-green-200 rounded hover:bg-green-50 transition font-medium">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
              </svg>
              Import
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function RMOneDrive() {
  const [activeFolder, setActiveFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<FileItem[]>(FILES);
  const fileInput = useRef<HTMLInputElement>(null);

  const filtered = files.filter(f => {
    const matchFolder = activeFolder === "all" || f.folder === activeFolder;
    const matchSearch = f.name.toLowerCase().includes(search.toLowerCase());
    return matchFolder && matchSearch;
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const handleUpload = (fakeNames?: string[]) => {
    const names = fakeNames || ["New File.xlsx"];
    names.forEach(name => {
      setFiles(prev => [{
        id: Date.now() + Math.random(),
        name,
        folder: activeFolder === "all" ? "projects" : activeFolder,
        type: "xlsx",
        size: `${Math.floor(Math.random() * 200 + 30)} KB`,
        updated: "Jun 29, 2025",
        uploadedBy: "You",
      }, ...prev]);
    });
    showToast(`✅ ${names.length} file${names.length > 1 ? "s" : ""} uploaded successfully`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).map(f => f.name);
    if (dropped.length) handleUpload(dropped);
  };

  const activeLabel = FOLDERS.find(f => f.id === activeFolder)?.label ?? "All Files";
  const folderCounts: Record<string, number> = {};
  files.forEach(f => {
    folderCounts["all"] = (folderCounts["all"] || 0) + 1;
    folderCounts[f.folder] = (folderCounts[f.folder] || 0) + 1;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-800 text-sm">Drive</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5 w-56">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              className="bg-transparent text-xs outline-none flex-1 text-gray-600 placeholder-gray-400"
              placeholder="Search files…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => handleUpload(["Uploaded File.xlsx"])}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload File
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 bg-white border-r border-gray-200 flex flex-col py-4 px-3 shrink-0">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">Folders</p>
          {FOLDERS.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFolder(f.id)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition mb-0.5 ${
                activeFolder === f.id
                  ? "bg-indigo-50 text-indigo-700 font-semibold"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>{f.icon}</span>
                <span>{f.label}</span>
              </span>
              {folderCounts[f.id] && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeFolder === f.id ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-500"}`}>
                  {folderCounts[f.id]}
                </span>
              )}
            </button>
          ))}

          <div className="mt-auto pt-4 border-t border-gray-100 px-2">
            <div className="text-xs text-gray-400 mb-1">Storage used</div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: "34%" }} />
            </div>
            <div className="text-xs text-gray-400 mt-1">3.4 GB of 10 GB</div>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Drop zone banner */}
          <div
            className={`mx-6 mt-5 border-2 border-dashed rounded-xl p-4 flex items-center gap-4 transition-colors cursor-pointer ${
              dragOver ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInput.current?.click()}
          >
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Drag & drop files here, or <span className="text-indigo-600 underline">click to browse</span></p>
              <p className="text-xs text-gray-400 mt-0.5">Supports Excel, PDF, Word, CSV — up to 50 MB</p>
            </div>
            <input ref={fileInput} type="file" className="hidden" multiple onChange={e => {
              const names = Array.from(e.target.files || []).map(f => f.name);
              if (names.length) handleUpload(names);
            }} />
          </div>

          {/* File table */}
          <div className="mx-6 my-4 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-sm text-gray-700">{activeLabel}</span>
              <span className="text-xs text-gray-400">{filtered.length} file{filtered.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="overflow-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Name</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Type</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Size</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Last Updated</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Uploaded By</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-sm text-gray-400">
                        No files found
                      </td>
                    </tr>
                  ) : (
                    filtered.map(f => (
                      <FileRow key={f.id} file={f} onDownload={name => showToast(`⬇️ Downloading "${name}"…`)} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-5 py-2.5 rounded-lg shadow-lg flex items-center gap-2 z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
