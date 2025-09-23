// Klassekartografen JavaScript - Copyright Benjamin Ensrud, 2025. Version 1.1

// Canvas state variables
let students = [];
let gridCells = [];
let dragging = null;
let dragOffset = { x: 0, y: 0 };
let rows = 5;
let rowSpacing = 60;
let deskSpacing = 30;
let cellWidth = 120;
let cellHeight = 80;
let poolWidth = 220; // Match with CSS
let poolStudents = [];
let groupName = "Please Load Student List";
let linkMode = false;
let links = new Set();
let linkStart = null;
let rowSizes = [6, 6, 6, 6, 6]; // Default sizes for each row
let zoomFactor = 1; // Scale factor for responsive sizing
let studentPool = null; // Reference to the student pool DOM element
let savedLayouts = {};
let currentLayoutId = null;

// LocalStorage keys
const STORAGE_KEYS = {
    GROUP_NAME: 'klassekartograf_groupName',
    POOL_STUDENTS: 'klassekartograf_poolStudents',
    GRID_CELLS: 'klassekartograf_gridCells',
    LINKS: 'klassekartograf_links',
    SETTINGS: 'klassekartograf_settings',
    WALKTHROUGH_SEEN: 'seatingWalkthroughSeen',
    SAVED_LAYOUTS: 'klassekartograf_savedLayouts',
    CURRENT_LAYOUT_ID: 'klassekartograf_currentLayoutId'
};

// ----- Layout helpers -----
function getSavedLayouts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.SAVED_LAYOUTS) || '{}'); }
  catch { return {}; }
}
function setSavedLayouts(map) {
  localStorage.setItem(STORAGE_KEYS.SAVED_LAYOUTS, JSON.stringify(map));
}
function setCurrentLayoutId(id) {
  currentLayoutId = id || null;
  if (id) localStorage.setItem(STORAGE_KEYS.CURRENT_LAYOUT_ID, id);
  else localStorage.removeItem(STORAGE_KEYS.CURRENT_LAYOUT_ID);
}
function getCurrentLayoutId() {
  return localStorage.getItem(STORAGE_KEYS.CURRENT_LAYOUT_ID);
}
function slug(str) {
  return (str || 'oppsett').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');
}
function makeId(name) {
  return `${slug(name)}-${Date.now().toString(36)}`;
}

function snapshotCurrentLayout(nameOverride) {
  // Only store cells that actually have a student (like saveProgress does)
  const gridData = gridCells
    .filter(c => c.student)
    .map(c => ({ row: c.row, col: c.col, student: c.student }));

  return {
    id: currentLayoutId || null,
    name: nameOverride || groupName || 'Oppsett',
    groupName,
    poolStudents: [...poolStudents],
    links: Array.from(links),
    settings: { rows, rowSpacing, deskSpacing, rowSizes: [...rowSizes] },
    grid: gridData,
    updatedAt: Date.now()
  };
}

function saveLayoutAs() {
  const defaultName = groupName && groupName !== "Please Load Student List" ? groupName : "Ny klasse";
  const name = prompt("Navn på oppsett:", defaultName);
  if (!name) return;

  const layouts = getSavedLayouts();
  const id = makeId(name);
  const data = snapshotCurrentLayout(name);
  data.id = id;

  layouts[id] = data;
  setSavedLayouts(layouts);
  setCurrentLayoutId(id);
  refreshLayoutSelect(id);
  showNotification(`Oppsett "${name}" lagret`, 2000, 'success');
}

function saveLayoutOverwrite() {
  const id = currentLayoutId || getCurrentLayoutId();
  if (!id) return saveLayoutAs();

  const layouts = getSavedLayouts();
  const existing = layouts[id];
  const name = existing ? existing.name : (groupName || "Oppsett");
  const data = snapshotCurrentLayout(name);
  data.id = id;

  layouts[id] = data;
  setSavedLayouts(layouts);
  refreshLayoutSelect(id);
  showNotification(`Oppsett "${name}" oppdatert`, 1500, 'success');
}

function loadLayoutById(id) {
  const layouts = getSavedLayouts();
  const layout = layouts[id];
  if (!layout) return;

  // COMPLETELY CLEAR ALL EXISTING STATE FIRST
  // Clear all grid cells
  for (let cell of gridCells) {
    cell.student = null;
  }
  
  // Clear the pool completely
  poolStudents = [];
  
  // Clear links
  links.clear();
  
  // Reset dragging state
  dragging = null;
  linkStart = null;

  // NOW APPLY THE SAVED LAYOUT SETTINGS
  rows        = layout.settings.rows;
  rowSpacing  = layout.settings.rowSpacing;
  deskSpacing = layout.settings.deskSpacing;
  rowSizes    = [...layout.settings.rowSizes];

  // Update input controls to match
  document.getElementById('rows').value = rows;
  document.getElementById('rowSpacing').value = rowSpacing;
  document.getElementById('deskSpacing').value = deskSpacing;

  // Apply group name
  groupName = layout.groupName || layout.name;
  document.getElementById('groupName').textContent = groupName;
  
  // Apply links
  links = new Set(layout.links || []);

  // Rebuild the grid structure with cleared state
  // We need to do this manually to avoid the updateGrid() function 
  // adding orphaned students to the pool
  gridCells = [];
  for (let i = 0; i < rowSizes.length; i++) {
    for (let j = 0; j < rowSizes[i]; j++) {
      const pos = getCellPosition(i, j);
      gridCells.push({
        x: pos.x,
        y: pos.y,
        row: i,
        col: j,
        student: null // Start with all cells empty
      });
    }
  }

  // NOW set the pool students and apply placements
  poolStudents = [...layout.poolStudents];
  
  // Apply student placements to grid
  layout.grid.forEach(savedCell => {
    const cell = gridCells.find(c => c.row === savedCell.row && c.col === savedCell.col);
    if (cell && savedCell.student) {
      cell.student = savedCell.student;
      // Remove this student from pool since they're now placed
      const idx = poolStudents.indexOf(savedCell.student);
      if (idx !== -1) {
        poolStudents.splice(idx, 1);
      }
    }
  });

  // Update the UI
  updateStudentPool();
  setCurrentLayoutId(id);
  refreshLayoutSelect(id);
  showNotification(`Oppsett "${layout.name}" lastet`, 1500, 'success');
}

function deleteLayout(id) {
  const layouts = getSavedLayouts();
  const name = layouts[id]?.name || 'Oppsett';
  if (!layouts[id]) return;

  if (confirm(`Slette oppsett "${name}"?`)) {
    delete layouts[id];
    setSavedLayouts(layouts);
    const wasCurrent = id === currentLayoutId;
    if (wasCurrent) setCurrentLayoutId(null);
    refreshLayoutSelect(null);
    showNotification(`Oppsett "${name}" slettet`, 1500, 'success');
  }
}

function refreshLayoutSelect(selectIdToMark) {
  const sel = document.getElementById('layoutSelect');
  if (!sel) return;

  const layouts = getSavedLayouts();
  const entries = Object.values(layouts).sort((a,b) => b.updatedAt - a.updatedAt);

  sel.innerHTML = '<option value="">Velg oppsett</option>';
  for (const L of entries) {
    const opt = document.createElement('option');
    opt.value = L.id;
    opt.textContent = L.name;
    sel.appendChild(opt);
  }
  if (selectIdToMark) sel.value = selectIdToMark;
}

// Shows notification message
function showNotification(message, duration = 2000, type = 'default') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification show';
    
    // Add type class for styling
    if (type === 'success') {
        notification.classList.add('success');
    } else if (type === 'error') {
        notification.classList.add('error');
    }
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.className = 'notification'; // Reset classes
        }, 300);
    }, duration);
}

// Save current state to localStorage
function saveProgress() {
    try {
        // Save group name
        if (groupName && groupName !== "Please Load Student List" && groupName !== "Last inn elever for å begynne") {
            localStorage.setItem(STORAGE_KEYS.GROUP_NAME, groupName);
        }
        
        // Save pool students
        localStorage.setItem(STORAGE_KEYS.POOL_STUDENTS, JSON.stringify(poolStudents));
        
        // Save grid cells with student assignments
        const gridData = gridCells.map(cell => ({
            row: cell.row,
            col: cell.col,
            student: cell.student || null // Explicitly save null for empty cells
        })).filter(cell => cell.student !== null); // Only save cells with students

        localStorage.setItem(STORAGE_KEYS.GRID_CELLS, JSON.stringify(gridData));
        
        // Save links
        localStorage.setItem(STORAGE_KEYS.LINKS, JSON.stringify(Array.from(links)));
        
        // Save settings
        const settings = {
            rows: rows,
            rowSpacing: rowSpacing,
            deskSpacing: deskSpacing,
            rowSizes: rowSizes
        };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        
        showNotification("Fremgang lagret!", 2000, 'success');
    } catch (error) {
        console.error('Error saving progress:', error);
        showNotification("Feil ved lagring av fremgang", 3000, 'error');
    }
}

// Load saved state from localStorage
function loadProgress() {
    try {
        // Load group name
        const savedGroupName = localStorage.getItem(STORAGE_KEYS.GROUP_NAME);
        if (savedGroupName) {
            groupName = savedGroupName;
            document.getElementById('groupName').textContent = groupName;
        }
        
        // Load pool students
        const savedPoolStudents = localStorage.getItem(STORAGE_KEYS.POOL_STUDENTS);
        if (savedPoolStudents) {
            poolStudents = JSON.parse(savedPoolStudents);
        }
        
        // Load settings first
        const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            rows = settings.rows || 5;
            rowSpacing = settings.rowSpacing || 60;
            deskSpacing = settings.deskSpacing || 30;
            rowSizes = settings.rowSizes || [6, 6, 6, 6, 6];
            
            // Update UI controls
            document.getElementById('rows').value = rows;
            document.getElementById('rowSpacing').value = rowSpacing;
            document.getElementById('deskSpacing').value = deskSpacing;
        }
        
        // Load links
        const savedLinks = localStorage.getItem(STORAGE_KEYS.LINKS);
        if (savedLinks) {
            links = new Set(JSON.parse(savedLinks));
        }
        
        // Rebuild grid with loaded settings
        updateRowConfigs(true);
        
        // NOW load grid cell assignments AFTER the grid is rebuilt
        const savedGridData = localStorage.getItem(STORAGE_KEYS.GRID_CELLS);
        if (savedGridData) {
            const gridData = JSON.parse(savedGridData);
            
            // Apply student assignments to the newly rebuilt grid
            gridData.forEach(savedCell => {
                const matchingCell = gridCells.find(cell => 
                    cell.row === savedCell.row && cell.col === savedCell.col
                );
                if (matchingCell && savedCell.student) {
                    matchingCell.student = savedCell.student;
                    // Remove this student from pool if they're there
                    const poolIndex = poolStudents.indexOf(savedCell.student);
                    if (poolIndex !== -1) {
                        poolStudents.splice(poolIndex, 1);
                    }
                }
            });
        }
        
        updateStudentPool();
        showNotification("Fremgang lastet inn!", 2000, 'success');
    } catch (error) {
        console.error('Error loading progress:', error);
        showNotification("Feil ved lasting av fremgang", 3000, 'error');
    }
}

// Clear all saved data
function clearSavedProgress() {
    if (confirm("Er du sikker på at du vil slette all lagret data? Dette kan ikke angres.")) {
        try {
            Object.values(STORAGE_KEYS).forEach(key => {
                localStorage.removeItem(key);
            });
            
            // Reset to defaults
            groupName = "Please Load Student List";
            document.getElementById('groupName').textContent = "Last inn elever for å begynne";
            poolStudents = [];
            links.clear();
            rows = 5;
            rowSpacing = 60;
            deskSpacing = 30;
            rowSizes = [6, 6, 6, 6, 6];
            
            // Reset UI controls
            document.getElementById('rows').value = rows;
            document.getElementById('rowSpacing').value = rowSpacing;
            document.getElementById('deskSpacing').value = deskSpacing;
            
            // Rebuild grid
            updateRowConfigs();
            updateStudentPool();
            
            showNotification("All lagret data er slettet", 2000, 'success');
        } catch (error) {
            console.error('Error clearing saved data:', error);
            showNotification("Feil ved sletting av data", 3000, 'error');
        }
    }
}

// Auto-save function - called whenever significant changes are made
function autoSave() {
    // Only auto-save if we have meaningful data
    if (groupName !== "Please Load Student List" && groupName !== "Last inn elever for å begynne") {
        saveProgress();
    }
}

// Update the student pool DOM
function updateStudentPool() {
    if (!studentPool) {
        // Create student pool if it doesn't exist
        studentPool = document.createElement('div');
        studentPool.className = 'student-pool';
        studentPool.id = 'studentPool';
        
        const poolHeader = document.createElement('div');
        poolHeader.className = 'pool-header';
        poolHeader.innerHTML = 'Elever <button class="add-student-btn" onclick="toggleAddStudentsModal(true)" title="Legg til elever">+</button>';
        
        const poolContent = document.createElement('div');
        poolContent.className = 'pool-content';
        poolContent.id = 'poolContent';
        
        studentPool.appendChild(poolHeader);
        studentPool.appendChild(poolContent);
        document.querySelector('.main-content').appendChild(studentPool);
    }
    
    const poolContent = document.getElementById('poolContent');
    poolContent.innerHTML = '';
    
    if (poolStudents.length === 0) {
        poolContent.innerHTML = '<div class="empty-pool">Ingen tilgjengelige elever</div>';
    } else {
        poolStudents.forEach((student, index) => {
            const studentElement = document.createElement('div');
            studentElement.className = 'student-item';
            studentElement.textContent = student;
            studentElement.setAttribute('data-student', student);
            
            // Add delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-student-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Fjern elev';
            
            // Use mousedown instead of click to prevent drag conflict
            deleteBtn.addEventListener('mousedown', function(e) {
                e.stopPropagation(); // Prevent triggering drag
                e.preventDefault(); // Prevent default behavior
                
                // Remove the student
                const studentToRemove = poolStudents[index];
                poolStudents.splice(index, 1);
                
                // Update the pool display using setTimeout to avoid event conflicts
                setTimeout(() => {
                    updateStudentPool();
                    autoSave(); // Auto-save after removing student
                    showNotification(`Fjernet ${studentToRemove} fra elevlisten`);
                }, 10);
                
                return false;
            });
            
            studentElement.appendChild(deleteBtn);
            poolContent.appendChild(studentElement);
        });
    }
    
    // Setup drag events after updating the pool
    setupStudentDragEvents();
}

// Function to remove a student from the pool
function removeStudentFromPool(index) {
    // Get student name for notification
    const studentName = poolStudents[index];
    
    // Remove the student
    poolStudents.splice(index, 1);
    
    // Update the pool and show notification
    updateStudentPool();
    autoSave(); // Auto-save after removing student
    showNotification(`Fjernet ${studentName} fra elevlisten`);
}

// Function to handle class name modal
function toggleClassNameModal(show) {
    const modal = document.getElementById('classNameModal');
    if (show) {
        modal.classList.add('show');
        document.getElementById('classNameInput').value = groupName;
        setTimeout(() => document.getElementById('classNameInput').focus(), 100);
    } else {
        modal.classList.remove('show');
    }
}

// Function to save the class name
function saveClassName() {
    const newName = document.getElementById('classNameInput').value.trim();
    if (newName) {
        groupName = newName;
        document.getElementById('groupName').textContent = groupName;
        autoSave(); // Auto-save after changing class name
        showNotification(`Klassenavn endret til "${groupName}"`);
    }
    toggleClassNameModal(false);
}

// Function to handle add students modal
function toggleAddStudentsModal(show) {
    const modal = document.getElementById('addStudentsModal');
    if (show) {
        modal.classList.add('show');
        setTimeout(() => document.getElementById('studentsInput').focus(), 100);
    } else {
        modal.classList.remove('show');
    }
}

// Function to add students to the pool
function addStudentsToPool() {
    const input = document.getElementById('studentsInput').value;
    const newStudents = input.split('\n')
        .map(name => name.trim())
        .filter(name => name.length > 0);
    
    if (newStudents.length > 0) {
        poolStudents = [...poolStudents, ...newStudents];
        updateStudentPool();
        autoSave(); // Auto-save after adding students
        showNotification(`La til ${newStudents.length} nye elever`);
        toggleAddStudentsModal(false);
        document.getElementById('studentsInput').value = '';
    } else {
        showNotification("Ingen gyldige elevnavn ble lagt til");
    }
}

// Add keyboard events for the modals
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('classNameInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            saveClassName();
        } else if (e.key === 'Escape') {
            toggleClassNameModal(false);
        }
    });

    document.getElementById('studentsInput').addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            toggleAddStudentsModal(false);
        }
    });
});
        
function updateRowConfigs(skipAutoSave = false) {
    rows = parseInt(document.getElementById('rows').value);
    const configsDiv = document.getElementById('rowConfigs');
    configsDiv.innerHTML = '';
    
    while (rowSizes.length < rows) rowSizes.push(6);
    if (rowSizes.length > rows) rowSizes.length = rows;
    
    for (let i = 0; i < rows; i++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row-config';
        rowDiv.innerHTML = `
            <div class="row-number">${i + 1}</div>
            <input type="number" 
                   value="${rowSizes[i]}" 
                   min="1" 
                   max="12"
                   onchange="updateRowSize(${i}, this.value)">
        `;
        configsDiv.appendChild(rowDiv);
    }
    updateGrid(skipAutoSave);
}

function updateRowSize(rowIndex, size) {
    rowSizes[rowIndex] = parseInt(size);
    updateGrid();
    autoSave(); // Auto-save after changing row size
}

// Adjust cell sizes based on available space
function adjustCellSize() {
    const mainContent = document.querySelector('.main-content');
    const maxWidth = mainContent.offsetWidth;
    const maxHeight = mainContent.offsetHeight;
    
    // Calculate the maximum grid width and height
    const maxDesksInRow = Math.max(...rowSizes);
    const gridWidth = maxDesksInRow * cellWidth + (maxDesksInRow - 1) * deskSpacing;
    const gridHeight = rows * cellHeight + (rows - 1) * rowSpacing;
    
    // Calculate scaling factors
    const xFactor = (maxWidth - poolWidth - 80) / gridWidth;
    const yFactor = (maxHeight - 100) / gridHeight;
    
    // Use the smaller factor to maintain aspect ratio
    zoomFactor = Math.min(xFactor, yFactor, 1); // Cap at 1 to avoid oversizing
    
    // Update pool width based on sidebar width
    const sidebar = document.querySelector('.sidebar');
    poolWidth = Math.min(220, sidebar.offsetWidth - 40); // Match pool width to sidebar
    
    // Update pool position and width in CSS
    if (studentPool) {
        studentPool.style.width = `${poolWidth}px`;
    }
}

let myCanvas;

function setup() {
    console.log("p5.js setup running...");
    
    // Create canvas inside the canvasContainer
    myCanvas = createCanvas(
        document.querySelector('.main-content').offsetWidth,
        document.querySelector('.main-content').offsetHeight
    );
    myCanvas.parent('canvasContainer');
    
    // Now that canvas is initialized, we can safely call these functions
    console.log("Canvas initialized, setting up grid...");
    adjustCellSize();
    
    // Load saved progress before setting up the grid
    loadProgress();
    
    // If no saved data, use defaults
    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
        updateRowConfigs();
    }
    
    updateStudentPool();
    
    console.log("Grid setup complete");
}

function getCellPosition(row, col) {
    // Apply zoom factor to maintain responsive layout
    const scaledCellWidth = cellWidth * zoomFactor;
    const scaledCellHeight = cellHeight * zoomFactor;
    const scaledRowSpacing = rowSpacing * zoomFactor;
    const scaledDeskSpacing = deskSpacing * zoomFactor;
    
    let additionalSpace = 0;
    for (let c = 0; c < col; c++) {
        const linkKey = `${row},${c}-${row},${c+1}`;
        const reverseLinkKey = `${row},${c+1}-${row},${c}`;
        if (!links.has(linkKey) && !links.has(reverseLinkKey)) {
            additionalSpace += scaledDeskSpacing;
        }
    }

    // Calculate row offset to center the row
    const rowWidth = rowSizes[row] * scaledCellWidth + 
                (rowSizes[row] - 1) * (10 * zoomFactor + scaledDeskSpacing);
    const maxRowWidth = Math.max(...rowSizes) * scaledCellWidth + 
                    (Math.max(...rowSizes) - 1) * (10 * zoomFactor + scaledDeskSpacing);
    const rowOffset = (maxRowWidth - rowWidth) / 2;

    // Center the grid in the canvas, avoiding student pool
    // Use the canvas element's width instead of p5.js width if not available yet
    const canvasWidth = (typeof width !== 'undefined') ? width : 
                    document.querySelector('.main-content').offsetWidth;
    const centerX = canvasWidth / 2 + poolWidth/4;
    const gridStartX = centerX - maxRowWidth / 2; 

    return {
        x: gridStartX + rowOffset + col * (scaledCellWidth + 10 * zoomFactor) + additionalSpace,
        y: 80 + row * (scaledCellHeight + scaledRowSpacing)
    };
}

function updateGrid(skipAutoSave = false) {
    rowSpacing = parseInt(document.getElementById('rowSpacing').value);
    deskSpacing = parseInt(document.getElementById('deskSpacing').value);
    
    // Adjust cell sizes based on available space
    adjustCellSize();
    
    // Save the current student assignments before rebuilding grid
    const studentAssignments = {};
    for (let cell of gridCells) {
        if (cell.student) {
            // Use row,col as key to store student assignments
            studentAssignments[`${cell.row},${cell.col}`] = cell.student;
        }
    }
    
    // Rebuild grid cells
    gridCells = [];
    
    for (let i = 0; i < rowSizes.length; i++) {
        for (let j = 0; j < rowSizes[i]; j++) {
            const pos = getCellPosition(i, j);
            const key = `${i},${j}`;
            
            gridCells.push({
                x: pos.x,
                y: pos.y,
                row: i,
                col: j,
                // Restore student assignment or set to null if none
                student: studentAssignments[key] || null
            });
            
            // Remove this assignment from our tracking object if it was used
            if (studentAssignments[key]) {
                delete studentAssignments[key];
            }
        }
    }
    
    // Any remaining students in studentAssignments are "orphaned" and should be returned to the pool
    for (const key in studentAssignments) {
        poolStudents.push(studentAssignments[key]);
    }
    
    // Update the student pool DOM
    updateStudentPool();
    
    // Only auto-save if not loading from storage
    if (!skipAutoSave) {
        autoSave();
    }
}

function toggleLinkMode() {
    linkMode = !linkMode;
    document.getElementById('linkModeBtn').textContent = `🔗 Lenkemodus: ${linkMode ? 'PÅ' : 'AV'}`;
    document.getElementById('linkModeBtn').classList.toggle('active', linkMode);
    linkStart = null;
    if (linkMode) {
        showNotification("Lenkemodus aktivert. Trykk på koblingspunktene for å sammen-/frakoble pulter.");
    }
}

function handleLinkModeClick() {
    const scaledCellWidth = cellWidth * zoomFactor;
    const scaledCellHeight = cellHeight * zoomFactor;
    
    for (let cell of gridCells) {
        if (dist(mouseX, mouseY, cell.x + scaledCellWidth, cell.y + scaledCellHeight/2) < 10 * zoomFactor) {
            if (!linkStart) {
                linkStart = `${cell.row},${cell.col}`;
            }
            return;
        }
        if (dist(mouseX, mouseY, cell.x, cell.y + scaledCellHeight/2) < 10 * zoomFactor) {
            if (linkStart) {
                const linkEnd = `${cell.row},${cell.col}`;
                if (linkStart !== linkEnd) {
                    const [startRow, startCol] = linkStart.split(',').map(Number);
                    const [endRow, endCol] = linkEnd.split(',').map(Number);
                    
                    if (startRow === endRow && Math.abs(startCol - endCol) === 1) {
                        const link = `${linkStart}-${linkEnd}`;
                        const reverseLink = `${linkEnd}-${linkStart}`;
                        if (links.has(link)) {
                            links.delete(link);
                            showNotification("Pulter koblet fra hverandre");
                        } else if (links.has(reverseLink)) {
                            links.delete(reverseLink);
                            showNotification("Pulter koblet fra hverandre");
                        } else {
                            links.add(link);
                            showNotification("Pulter koblet sammen");
                        }
                        updateGrid(); // Update grid to reflect new spacing
                    } else {
                        showNotification("Kun nabopulter på samme rad kan kobles sammen", 1500);
                    }
                } else {
                    showNotification("Kan ikke koble en pult til seg selv", 1500);
                }
                linkStart = null;
            }
            return;
        }
    }
    linkStart = null;
}

// Fixed mouse interaction for canvas
function mousePressed() {
    if (!mouseInCanvas()) return;
    
    if (linkMode) {
        handleLinkModeClick();
        return;
    }

    const scaledCellWidth = cellWidth * zoomFactor;
    const scaledCellHeight = cellHeight * zoomFactor;
    
    // Check grid cells
    for (let cell of gridCells) {
        if (mouseX > cell.x && mouseX < cell.x + scaledCellWidth &&
            mouseY > cell.y && mouseY < cell.y + scaledCellHeight && cell.student) {
            dragging = cell.student;
            cell.student = null;
            dragOffset.x = (mouseX - cell.x) / zoomFactor;
            dragOffset.y = (mouseY - cell.y) / zoomFactor;
            updateStudentPool(); // Update the pool DOM
            return;
        }
    }
}

function mouseReleased() {
    if (!dragging) return;
    
    const scaledCellWidth = cellWidth * zoomFactor;
    const scaledCellHeight = cellHeight * zoomFactor;
    
    let placed = false;
    for (let cell of gridCells) {
        if (mouseX > cell.x && mouseX < cell.x + scaledCellWidth &&
            mouseY > cell.y && mouseY < cell.y + scaledCellHeight) {
            if (cell.student) {
                poolStudents.push(cell.student);
            }
            cell.student = dragging;
            placed = true;
            break;
        }
    }
    if (!placed) {
        poolStudents.push(dragging);
    }
    dragging = null;
    updateStudentPool(); // Update the pool DOM
    autoSave(); // Auto-save after student placement
}

// Helper function to check if mouse is in canvas
function mouseInCanvas() {
    const canvas = document.getElementById('defaultCanvas0');
    if (!canvas) return false;
    
    const rect = canvas.getBoundingClientRect();
    return (
        mouseX >= 0 && 
        mouseX < width && 
        mouseY >= 0 && 
        mouseY < height
    );
}

function randomizePlacements() {
    const allStudents = [...poolStudents];
    for (let cell of gridCells) {
        if (cell.student) {
            allStudents.push(cell.student);
            cell.student = null;
        }
    }
    
    if (allStudents.length === 0) {
        showNotification("Ingen elever å plassere");
        return;
    }
    
    const availableCells = [...gridCells];
    while (allStudents.length > 0 && availableCells.length > 0) {
        const studentIndex = Math.floor(Math.random() * allStudents.length);
        const cellIndex = Math.floor(Math.random() * availableCells.length);
        
        availableCells[cellIndex].student = allStudents[studentIndex];
        availableCells.splice(cellIndex, 1);
        allStudents.splice(studentIndex, 1);
    }
    
    poolStudents = allStudents;
    updateStudentPool(); // Update the pool DOM
    autoSave(); // Auto-save after randomization
    showNotification("Plasserte elever tilfeldig!");
}

function resetGrid() {
    for (let cell of gridCells) {
        if (cell.student) {
            poolStudents.push(cell.student);
            cell.student = null;
        }
    }
    links.clear();
    updateGrid();
    updateStudentPool(); // Update the pool DOM
    autoSave(); // Auto-save after reset
    showNotification("Tilbakestilte klassekart");
}

function exportPDF() {
    // Check if there's a valid class name and any students
    if (groupName === "Please Load Student List" || groupName === "Last inn elever for å begynne") {
        showNotification("Angi klassenavn og elever først");
        return;
    }
    
    // Check if there are any students (either placed or in pool)
    const hasStudents = poolStudents.length > 0 || gridCells.some(cell => cell.student);
    if (!hasStudents) {
        showNotification("Legg til minst én elev først");
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a3'
    });
    
    // Page dimensions and layout settings
    const pageWidth = 420;
    const pageHeight = 297;
    const margin = 20;
    const headerSpace = 40;
    const footerSpace = 15;
    
    // Colors (matching the app's color scheme)
    const primaryColor = [63, 81, 181]; // RGB format for primary blue
    const primaryLightColor = [121, 134, 203]; // Lighter blue
    const borderColor = [224, 224, 224]; // Light gray for borders
    const textColor = [66, 66, 66]; // Dark gray for text
    
    // Create date objects and strings
    const today = new Date();
    const displayDateStr = today.toLocaleDateString('no-NO', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    const fileDateStr = today.toISOString().split('T')[0]; // Format as YYYY-MM-DD for filename
    
    // Add a header background
    pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.rect(0, 0, pageWidth, headerSpace, 'F');
    
    // Add title text
    pdf.setFontSize(28);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(255, 255, 255); // White text on blue background
    pdf.text(groupName, pageWidth/2, headerSpace/2 + 5, { align: 'center', baseline: 'middle' });
    
    // Add subtitle with date
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Klassekart opprettet: ${displayDateStr}`, pageWidth/2, headerSpace - 8, { align: 'center' });
    
    // Calculate available space for the seating chart
    const availableWidth = pageWidth - 2 * margin;
    const availableHeight = pageHeight - 2 * margin - headerSpace - footerSpace;
    
    // Calculate total grid dimensions
    const maxDesksInRow = Math.max(...rowSizes);
    let totalGridWidth = maxDesksInRow * cellWidth;
    for (let i = 0; i < maxDesksInRow - 1; i++) {
        totalGridWidth += deskSpacing;
    }
    const totalGridHeight = rows * cellHeight + (rows - 1) * rowSpacing;
    
    // Calculate scaling factors to fit the grid on the page
    const scaleX = availableWidth / totalGridWidth;
    const scaleY = availableHeight / totalGridHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // Scale dimensions
    const scaledCellWidth = cellWidth * scale;
    const scaledCellHeight = cellHeight * scale;
    const scaledRowSpacing = rowSpacing * scale;
    const scaledDeskSpacing = deskSpacing * scale;
    
    // Start position for the grid
    const startY = margin + headerSpace;
    
    // Draw a background for the entire seating area
    pdf.setFillColor(245, 247, 250); // Light background color matching app background
    pdf.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    pdf.roundedRect(margin - 10, startY - 10, availableWidth + 20, availableHeight + 10, 5, 5, 'FD');
    
    // Add a legend for linked desks
    pdf.setFillColor(245, 247, 250);
    pdf.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    pdf.roundedRect(margin, pageHeight - footerSpace - 15, 100, 18, 3, 3, 'FD');
    
    // Legend text
    pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    pdf.setFontSize(10);
    pdf.text("Sammenkoblede pulter:", margin + 5, pageHeight - footerSpace - 6);
    
    // Legend example line
    pdf.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.setLineWidth(1.5);
    pdf.line(margin + 50, pageHeight - footerSpace - 7, margin + 90, pageHeight - footerSpace - 7);
    
    // Set default text color for the rest of the document
    pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    
    // Draw cells row by row
    let currentCell = 0;
    for (let row = 0; row < rowSizes.length; row++) {
        const rowWidth = rowSizes[row] * scaledCellWidth + (rowSizes[row] - 1) * scaledDeskSpacing;
        const startX = (pageWidth - rowWidth) / 2;
        
        // Add row label
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.text(`Rad ${row + 1}`, margin, startY + row * (scaledCellHeight + scaledRowSpacing) + scaledCellHeight/2, {
            baseline: 'middle'
        });
        
        // Draw cells in this row
        for (let col = 0; col < rowSizes[row]; col++) {
            const cell = gridCells[currentCell];
            let x = startX + col * (scaledCellWidth + scaledDeskSpacing);
            const y = startY + row * (scaledCellHeight + scaledRowSpacing);
            
            // Draw desk shadow
            pdf.setFillColor(0, 0, 0, 0.1); // Light shadow
            pdf.roundedRect(x + 1.5, y + 1.5, scaledCellWidth, scaledCellHeight, 3, 3, 'F');
            
            // Draw desk background
            pdf.setFillColor(255, 255, 255); // White background
            pdf.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
            pdf.roundedRect(x, y, scaledCellWidth, scaledCellHeight, 3, 3, 'FD');
            
            // Draw student name with better formatting
            if (cell && cell.student) {
                // Draw a colored header bar for the desk
                pdf.setFillColor(primaryLightColor[0], primaryLightColor[1], primaryLightColor[2], 0.3);
                pdf.rect(x, y, scaledCellWidth, scaledCellHeight * 0.25, 'F');
                
                // Draw student name
                pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
                pdf.setFontSize(11);
                pdf.setFont('helvetica', 'bold');
                
                // Handle long names with wrapping
                const textX = x + scaledCellWidth/2;
                const textY = y + scaledCellHeight/2 + 5;
                
                // Adjust font size for very long names
                const nameLength = cell.student.length;
                const fontSize = nameLength > 15 ? 9 : 11;
                pdf.setFontSize(fontSize);
                
                pdf.text(cell.student, textX, textY, { 
                    align: 'center', 
                    maxWidth: scaledCellWidth - 4
                });
                
                // Add a small desk icon on top
                pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2], 0.7);
                const iconSize = 3;
                pdf.rect(x + (scaledCellWidth - iconSize*2)/2, y + 4, iconSize*2, iconSize, 'F');
            } 
            // No special styling for empty desks - they will remain blank
            
            currentCell++;
        }
        
        // Draw links in this row with improved styling
        for (let link of links) {
            const [cell1Pos, cell2Pos] = link.split('-').map(pos => {
                const [r, c] = pos.split(',').map(Number);
                if (r !== row) return null;
                
                let x = startX + c * (scaledCellWidth + scaledDeskSpacing);
                
                return {
                    x: x,
                    y: startY + r * (scaledCellHeight + scaledRowSpacing)
                };
            }).filter(pos => pos !== null);
            
            if (cell1Pos && cell2Pos) {
                // Draw nicer looking link between desks
                pdf.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
                pdf.setLineWidth(1.5);
                pdf.line(cell1Pos.x + scaledCellWidth, cell1Pos.y + scaledCellHeight/2,
                        cell2Pos.x, cell2Pos.y + scaledCellHeight/2);
                
                // Add small circles at connection points
                pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
                pdf.circle(cell1Pos.x + scaledCellWidth, cell1Pos.y + scaledCellHeight/2, 1.5, 'F');
                pdf.circle(cell2Pos.x, cell2Pos.y + scaledCellHeight/2, 1.5, 'F');
            }
        }
    }
    
    // Add footer with page info
    pdf.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2], 0.5);
    pdf.setLineWidth(0.5);
    pdf.line(margin, pageHeight - footerSpace + 5, pageWidth - margin, pageHeight - footerSpace + 5);
    
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("Klassekartograf - Klasseromskart", margin, pageHeight - 7);
    pdf.text("Side 1/1", pageWidth - margin, pageHeight - 7, { align: 'right' });
    
    // Create a file-friendly version of the class name
    // Remove any characters that might cause problems in filenames
    const cleanClassName = groupName.replace(/[\/\\:*?"<>|]/g, '_').trim();
    
    // Save the PDF with custom filename
    const fileName = `${cleanClassName} ${fileDateStr}.pdf`;
    pdf.save(fileName);
    showNotification(`PDF "${fileName}" er lastet ned!`);
}

function draw() {
    background(245, 247, 250); // Light background color
    
    const scaledCellWidth = cellWidth * zoomFactor;
    const scaledCellHeight = cellHeight * zoomFactor;
    const cornerRadius = Math.max(1, 8 * zoomFactor); // Ensure minimum radius of 1
    
    // Draw links between desks
    stroke(63, 81, 181, 180); // Primary color
    strokeWeight(4 * zoomFactor);
    for (let link of links) {
        const [cell1, cell2] = link.split('-').map(pos => {
            const [row, col] = pos.split(',').map(Number);
            return getCellPosition(row, col);
        });
        line(cell1.x + scaledCellWidth, cell1.y + scaledCellHeight/2, 
             cell2.x, cell2.y + scaledCellHeight/2);
    }
    
    // Draw grid cells
    strokeWeight(1 * zoomFactor);
    for (let cell of gridCells) {
        const isHighlighted = linkMode && 
            (dist(mouseX, mouseY, cell.x + scaledCellWidth, cell.y + scaledCellHeight/2) < 10 * zoomFactor ||
             dist(mouseX, mouseY, cell.x, cell.y + scaledCellHeight/2) < 10 * zoomFactor);
        
        if (isHighlighted) {
            fill(240, 240, 240);
            stroke(63, 81, 181);
            strokeWeight(2 * zoomFactor);
        } else {
            fill(255, 255, 255);
            stroke(224, 224, 224);
            strokeWeight(1 * zoomFactor);
        }
        
        // Shadow effect for cells
        noStroke();
        fill(0, 0, 0, 10);
        rect(cell.x + 3 * zoomFactor, cell.y + 3 * zoomFactor, scaledCellWidth, scaledCellHeight, cornerRadius);
        
        // Cell itself
        if (isHighlighted) {
            fill(240, 240, 240);
            stroke(63, 81, 181);
            strokeWeight(2 * zoomFactor);
        } else {
            fill(255, 255, 255);
            stroke(224, 224, 224);
            strokeWeight(1 * zoomFactor);
        }
        rect(cell.x, cell.y, scaledCellWidth, scaledCellHeight, cornerRadius);
        
        if (cell.student) {
            fill(66, 66, 66); // Dark text for better contrast
            noStroke();
            textAlign(CENTER, CENTER);
            textSize(14 * zoomFactor);
            text(cell.student, cell.x + scaledCellWidth/2, cell.y + scaledCellHeight/2);
        }
        
        // Show link points in link mode
        if (linkMode) {
            const leftHighlight = dist(mouseX, mouseY, cell.x, cell.y + scaledCellHeight/2) < 10 * zoomFactor;
            const rightHighlight = dist(mouseX, mouseY, cell.x + scaledCellWidth, cell.y + scaledCellHeight/2) < 10 * zoomFactor;
            
            // Left connection point
            if (leftHighlight) {
                fill(63, 81, 181);
                stroke(255, 255, 255, 100);
                strokeWeight(2 * zoomFactor);
            } else {
                fill(200, 200, 200);
                noStroke();
            }
            circle(cell.x, cell.y + scaledCellHeight/2, 10 * zoomFactor);
            
            // Right connection point
            if (rightHighlight) {
                fill(63, 81, 181);
                stroke(255, 255, 255, 100);
                strokeWeight(2 * zoomFactor);
            } else {
                fill(200, 200, 200);
                noStroke();
            }
            circle(cell.x + scaledCellWidth, cell.y + scaledCellHeight/2, 10 * zoomFactor);
            
            // Show active link start
            if (linkStart === `${cell.row},${cell.col}`) {
                stroke(63, 81, 181);
                strokeWeight(2 * zoomFactor);
                noFill();
                circle(cell.x + scaledCellWidth, cell.y + scaledCellHeight/2, 15 * zoomFactor);
            }
        }
    }
    
    // Draw dragging student
    if (dragging) {
        // Shadow effect for dragged item
        noStroke();
        fill(0, 0, 0, 20);
        rect(mouseX - dragOffset.x * zoomFactor + 5 * zoomFactor, 
             mouseY - dragOffset.y * zoomFactor + 5 * zoomFactor, 
             scaledCellWidth, scaledCellHeight, cornerRadius);
        
        // Dragged item
        fill(121, 134, 203); // Lighter primary color
        stroke(63, 81, 181);
        strokeWeight(2 * zoomFactor);
        rect(mouseX - dragOffset.x * zoomFactor, 
             mouseY - dragOffset.y * zoomFactor, 
             scaledCellWidth, scaledCellHeight, cornerRadius);
        
        fill(255, 255, 255); // White text on colored background
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(14 * zoomFactor);
        text(dragging, 
             mouseX - dragOffset.x * zoomFactor + scaledCellWidth/2, 
             mouseY - dragOffset.y * zoomFactor + scaledCellHeight/2);
        
        // Show "drop zone" highlight
        for (let cell of gridCells) {
            if (mouseX > cell.x && mouseX < cell.x + scaledCellWidth &&
                mouseY > cell.y && mouseY < cell.y + scaledCellHeight) {
                noFill();
                stroke(63, 81, 181);
                strokeWeight(3 * zoomFactor);
                rect(cell.x, cell.y, scaledCellWidth, scaledCellHeight, cornerRadius);
                break;
            }
        }
    }
    
    // Draw link in progress
    if (linkStart && linkMode) {
        const [startRow, startCol] = linkStart.split(',').map(Number);
        const startPos = getCellPosition(startRow, startCol);
        stroke(63, 81, 181, 150);
        strokeWeight(3 * zoomFactor);
        line(startPos.x + scaledCellWidth, startPos.y + scaledCellHeight/2, mouseX, mouseY);
    }
}

// Setup drag events for student items
function setupStudentDragEvents() {
    // Get all student items
    const studentItems = document.querySelectorAll('.student-item');
    
    studentItems.forEach(item => {
        // Remove any existing event listeners
        item.removeEventListener('mousedown', handleStudentMouseDown);
        
        // Add new event listener
        item.addEventListener('mousedown', handleStudentMouseDown);
    });
}

// Handle student item mouse down
function handleStudentMouseDown(e) {
    // Skip if clicked on the delete button
    if (e.target.classList.contains('delete-student-btn')) {
        return;
    }
    
    e.preventDefault();
    const studentName = this.getAttribute('data-student');
    const index = poolStudents.indexOf(studentName);
    if (index !== -1) {
        dragging = studentName;
        poolStudents.splice(index, 1);
        updateStudentPool();
        autoSave(); // Add this line
        
        const canvasRect = document.getElementById('defaultCanvas0').getBoundingClientRect();
        const itemRect = this.getBoundingClientRect();
        
        const canvasX = e.clientX - canvasRect.left;
        const canvasY = e.clientY - canvasRect.top;
        
        dragOffset.x = (cellWidth * zoomFactor) / 2;
        dragOffset.y = (cellHeight * zoomFactor) / 2;
        
        mouseX = canvasX;
        mouseY = canvasY;
    }
}

// File input handling
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('fileInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const text = e.target.result;
                const lines = text.split('\n')
                    .map(name => name.trim())
                    .filter(name => name.length > 0);
                
                if (lines.length > 0) {
                    groupName = lines[0];
                    document.getElementById('groupName').textContent = groupName;
                    poolStudents = lines.slice(1);
                    resetGrid();
                    updateStudentPool();
                    autoSave(); // Auto-save after loading file
                    showNotification(`Lastet inn ${poolStudents.length} elever fra ${file.name}`);
                } else {
                    showNotification("Filen ser ut til å være tom");
                }
            };
            reader.readAsText(file);
        }
    });
});

function windowResized() {
    resizeCanvas(
        document.querySelector('.main-content').offsetWidth,
        document.querySelector('.main-content').offsetHeight
    );
    updateGrid(); // This will also call adjustCellSize()
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.key === 'l' || e.key === 'L') {
        if (!e.ctrlKey && !e.metaKey) { // Avoid conflict with browser shortcuts
            toggleLinkMode();
        }
    } else if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey) { // Avoid conflict with browser shortcuts
            randomizePlacements();
        }
    } else if (e.key === 'Escape') {
        if (linkMode) {
            toggleLinkMode();
        }
        linkStart = null;
        if (dragging) {
            poolStudents.push(dragging);
            dragging = null;
            updateStudentPool();
            showNotification("Handling avbrutt");
        }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); // Prevent browser save dialog
        saveProgress();
    }
});

function setupWalkthrough() {
    console.log("setupWalkthrough function called");

    // Check if user has seen the walkthrough before
    if (localStorage.getItem(STORAGE_KEYS.WALKTHROUGH_SEEN) === 'true') {
        console.log("User has seen walkthrough before, skipping");
        return;
    }
    
    // Create modal HTML with fixed content structure
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-container">
            <div class="modal-header">
                <h2 class="modal-title">Velkommen til Klassekartograf</h2>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="walkthrough-content" style="flex: 1;">
                    <!-- Step 1: Introduction -->
                    <div class="walkthrough-step active" data-step="1">
                        <h3>Velkommen!</h3>
                        <p>Dette verktøyet hjelper deg å lage og administrere klassekart enkelt.</p>
                        <p>Denne korte gjennomgangen vil vise deg hvordan du bruker alle nøkkelfunksjonene.</p>
                        <br>
                        <p><strong>Tips:</strong> Du kan klikke på punktene nederst for å hoppe mellom trinn.</p>
                    </div>
                    
                    <!-- Step 2: Loading Students -->
                    <div class="walkthrough-step" data-step="2">
                        <h3>Trinn 1: Last inn elevlisten din</h3>
                        <p>Start med å laste inn elevlisten din fra en tekstfil:</p>
                        <ul>
                            <li>Klikk på den blå "Last inn elever"-knappen (se høydepunkt)</li>
                            <li>Velg en tekstfil med gruppenavnet på første linje</li>
                            <li>Hvert elevnavn bør være på separate linjer etter gruppenavnet</li>
                        </ul>
                        <p>Når de er lastet inn, vil elevene vises i "Elever"-panelet til venstre på skjermen.</p>
                    </div>
                    
                    <!-- Step 3: Grid Setup -->
                    <div class="walkthrough-step" data-step="3">
                        <h3>Trinn 2: Konfigurer klasseromsoppsettet</h3>
                        <p>Tilpass klasseromsoppsettet i Innstillinger-panelet:</p>
                        <ul>
                            <li>Angi antall rader i klasserommet</li>
                            <li>Juster avstand mellom rader og pulter</li>
                            <li>Angi hvor mange pulter som er i hver rad (se høydepunkt)</li>
                        </ul>
                        <p>Klassekartet vil automatisk oppdateres for å gjenspeile innstillingene dine.</p>
                    </div>
                    
                    <!-- Step 4: Placing Students -->
                    <div class="walkthrough-step" data-step="4">
                        <h3>Trinn 3: Plasser elevene dine</h3>
                        <p>Du kan plassere elever på to måter:</p>
                        <ul>
                            <li>Dra elever fra Elever-panelet til en tom pult på kartet</li>
                            <li>Klikk på "Tilfeldig plassering"-knappen for å automatisk tildele plasser</li>
                        </ul>
                        <p>For å flytte en elev, bare dra dem til en annen pult eller tilbake til elevlisten.</p>
                        <br>
                        <p><em>Elevlisten vises når du har lastet inn elever fra en fil.</em></p>
                    </div>
                    
                    <!-- Step 5: Linking Desks -->
                    <div class="walkthrough-step" data-step="5">
                        <h3>Trinn 4: Koble pulter sammen</h3>
                        <p>Du kan koble sammen pulter som står ved siden av hverandre:</p>
                        <ul>
                            <li>Klikk på "Lenkemodus"-knappen (se høydepunkt) for å aktivere</li>
                            <li>Klikk på koblingspunktet på høyresiden av en pult</li>
                            <li>Deretter klikk på venstresiden av nabopulten</li>
                            <li>Klikk samme steder igjen for å frakoble</li>
                        </ul>
                        <p>Kun pulter ved siden av hverandre i samme rad kan kobles sammen.</p>
                    </div>
                    
                    <!-- Step 6: Saving Progress -->
                    <div class="walkthrough-step" data-step="6">
                        <h3>Trinn 5: Lagre fremgang</h3>
                        <p>Applikasjonen lagrer automatisk endringene dine, men du kan også:</p>
                        <ul>
                            <li>Klikk på "Lagre fremgang"-knappen (se høydepunkt)</li>
                            <li>Bruk Ctrl+S (Cmd+S på Mac) for å lagre raskt</li>
                            <li>Klikk på "Last inn fremgang" for å gjenopprette</li>
                        </ul>
                        <p>All data lagres lokalt i nettleseren din.</p>
                    </div>
                    
                    <!-- Step 7: Exporting -->
                    <div class="walkthrough-step" data-step="7">
                        <h3>Trinn 6: Eksporter klassekartet</h3>
                        <p>Når du er fornøyd med plasseringen av elevene:</p>
                        <ul>
                            <li>Klikk på "Last ned klassekart"-knappen (se høydepunkt)</li>
                            <li>PDF-en vil inkludere gruppenavnet, alle elevplasseringer og pultlenker</li>
                            <li>Filen får automatisk dagens dato i filnavnet</li>
                        </ul>
                        <p>PDF-en er perfekt for utskrift eller deling med andre.</p>
                    </div>

                    <!-- Step 8: Keyboard Shortcuts -->
                    <div class="walkthrough-step" data-step="8">
                        <h3>Hurtigtaster og tips</h3>
                        <p>Effektiviser arbeidsflyten din med disse hurtigtastene:</p>
                        <ul>
                            <li><strong>L</strong> - Slå lenkemodus av/på</li>
                            <li><strong>R</strong> - Tilfeldig plassering av elever</li>
                            <li><strong>ESC</strong> - Avbryt gjeldende operasjon</li>
                            <li><strong>Ctrl+S</strong> - Lagre fremgang</li>
                        </ul>
                        <br>
                        <p><strong>Nå er du klar!</strong> Klikk "Fullfør" for å begynne å bruke applikasjonen.</p>
                    </div>
                </div>
                
                <div class="step-indicator">
                    <span class="step-dot active" data-step="1"></span>
                    <span class="step-dot" data-step="2"></span>
                    <span class="step-dot" data-step="3"></span>
                    <span class="step-dot" data-step="4"></span>
                    <span class="step-dot" data-step="5"></span>
                    <span class="step-dot" data-step="6"></span>
                    <span class="step-dot" data-step="7"></span>
                    <span class="step-dot" data-step="8"></span>
                </div>
            </div>
            <div class="modal-footer">
                <button id="prevStepBtn" class="btn">Forrige</button>
                <button id="nextStepBtn" class="btn">Neste</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Elements to highlight for each step
    const highlights = {
        2: () => document.querySelector('.file-upload'),
        3: () => document.getElementById('rowConfigs'),
        4: () => document.getElementById('studentPool'),
        5: () => document.getElementById('linkModeBtn'),
        6: () => document.querySelector('[onclick="saveProgress()"]'),
        7: () => document.querySelector('[onclick="exportPDF()"]')
    };
    
    // Create spotlight element
    let spotlightEl = null;
    
    // Show modal
    setTimeout(() => modal.classList.add('show'), 100);
    
    // Track current step
    let currentStep = 1;
    const totalSteps = 8;
    
    // Get button references
    const nextBtn = document.getElementById('nextStepBtn');
    const prevBtn = document.getElementById('prevStepBtn');
    const closeBtn = modal.querySelector('.modal-close');
    
    // Update button states
    function updateButtons() {
        prevBtn.style.visibility = currentStep === 1 ? 'hidden' : 'visible';
        nextBtn.textContent = currentStep === totalSteps ? 'Fullfør' : 'Neste';
    }
    
    // Create spotlight
    function createSpotlight(element) {
        removeSpotlight();
        
        if (!element) return;
        
        spotlightEl = element;
        
        // Create a clone of the element positioned above everything
        const clone = element.cloneNode(true);
        clone.id = 'tutorialClone';
        clone.className = element.className + ' tutorial-clone';
        
        const rect = element.getBoundingClientRect();
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        
        document.body.appendChild(clone);
    }

    // Simple remove spotlight function
    function removeSpotlight() {
        spotlightEl = null;
        
        // Remove any existing clone
        const existingClone = document.getElementById('tutorialClone');
        if (existingClone) {
            existingClone.remove();
        }
    }

    function scrollIntoViewAndWait(element) {
        return new Promise(resolve => {
            // Find the scrollable container (your sidebar is scrollable)
            const scroller = element.closest('.sidebar') || document.scrollingElement || document.documentElement;

            const getPos = () => (scroller === document.scrollingElement || scroller === document.documentElement)
            ? window.scrollY
            : scroller.scrollTop;

            // Start smooth scroll
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

            // rAF-based stability check (no brittle timeouts)
            let last = getPos();
            let stableMs = 0;
            const thresholdMs = 50;   // consider “stopped” after ~150ms of no movement
            const tick = () => {
            const now = getPos();
            if (now === last) {
                stableMs += 16;        // ~1 frame at 60fps
                if (stableMs >= thresholdMs) return resolve();
            } else {
                stableMs = 0;
                last = now;
            }
            requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }
    
    // Show specific step
    async function showStep(step) {
        removeSpotlight();
            // Hide/show step text
        document.querySelectorAll('.walkthrough-step').forEach(el => el.classList.remove('active'));
        const currentStepEl = document.querySelector(`.walkthrough-step[data-step="${step}"]`);
        if (currentStepEl) currentStepEl.classList.add('active');

        // Update dots
        document.querySelectorAll('.step-dot').forEach(dot => dot.classList.remove('active'));
        const currentDot = document.querySelector(`.step-dot[data-step="${step}"]`);
        if (currentDot) currentDot.classList.add('active');

        // Buttons
        updateButtons();

        // Spotlight with scroll wait
        if (highlights[step] && typeof highlights[step] === 'function') {
            const element = highlights[step]();
            if (element) {
            await scrollIntoViewAndWait(element);   // wait for scroll to settle
            createSpotlight(element);               // then place the clone
            } else {
            removeSpotlight();
            }
        } else {
            removeSpotlight();
        }
    }

    
    // Close walkthrough
    function closeWalkthrough() {
        removeSpotlight();
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
        localStorage.setItem(STORAGE_KEYS.WALKTHROUGH_SEEN, 'true');
    }
    
    // Event listeners
    nextBtn.addEventListener('click', () => {
        if (currentStep < totalSteps) {
            currentStep++;
            showStep(currentStep);
        } else {
            closeWalkthrough();
        }
    });
    
    prevBtn.addEventListener('click', () => {
        if (currentStep > 1) {
            currentStep--;
            showStep(currentStep);
        }
    });
    
    closeBtn.addEventListener('click', closeWalkthrough);
    
    // Step indicator clicks
    document.querySelectorAll('.step-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            currentStep = parseInt(dot.getAttribute('data-step'));
            showStep(currentStep);
        });
    });
    
    // Handle window resize to update spotlight position
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (spotlightEl && highlights[currentStep]) {
                const element = highlights[currentStep]();
                if (element) {
                    createSpotlight(element);
                }
            }
        }, 100);
    });
    
    // Initialize
    updateButtons();
    showStep(1);
}

function resetWalkthrough() {
    localStorage.removeItem(STORAGE_KEYS.WALKTHROUGH_SEEN);
    setupWalkthrough();
}

// Initialize the grid on load
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOMContentLoaded event fired");
    
    // Handle window resize events
    window.addEventListener('resize', windowResized);
    
    // Wait for p5.js to initialize before calling functions that depend on canvas
    // The updateRowConfigs will now be called inside setup() instead
    
    // Setup walkthrough after a delay to ensure everything is loaded
    setTimeout(function() {
        console.log("Setting up walkthrough...");
        setupWalkthrough();
    }, 2000); // Increased timeout to 2000ms to ensure canvas is ready
});

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('layoutSelect');
  const saveAsBtn = document.getElementById('saveAsLayoutBtn');
  const saveBtn   = document.getElementById('saveLayoutBtn');
  const delBtn    = document.getElementById('deleteLayoutBtn');

  if (sel) {
    sel.addEventListener('change', () => {
      const id = sel.value;
      if (id) loadLayoutById(id);
    });
  }
  if (saveAsBtn) saveAsBtn.addEventListener('click', saveLayoutAs);
  if (saveBtn)   saveBtn.addEventListener('click', saveLayoutOverwrite);
  if (delBtn)    delBtn.addEventListener('click', () => {
    const id = document.getElementById('layoutSelect').value || currentLayoutId;
    if (id) deleteLayout(id);
  });

  // Populate list & optionally auto-load last used layout
  refreshLayoutSelect(getCurrentLayoutId());
  const last = getCurrentLayoutId();
  if (last) {
    // Optional: auto-load last
    loadLayoutById(last);
  }
});