// Create the main container
const container = document.createElement('div');
container.style.display = 'flex';
container.style.fontFamily = 'Arial, sans-serif';
container.style.backgroundColor = '#f0f0f0';
document.body.appendChild(container);

// Create the sidebar
const sidebar = document.createElement('div');
sidebar.style.width = '250px';
sidebar.style.padding = '20px';
sidebar.style.backgroundColor = '#2c3e50';
sidebar.style.color = '#ecf0f1';
sidebar.style.overflowY = 'auto';
sidebar.style.height = '100vh';
container.appendChild(sidebar);

// Create the canvas container
const canvasContainer = document.createElement('div');
canvasContainer.style.flex = '1';
canvasContainer.style.padding = '20px';
canvasContainer.style.display = 'flex';
canvasContainer.style.justifyContent = 'center';
canvasContainer.style.alignItems = 'center';
container.appendChild(canvasContainer);

// Create the canvas
const canvas = document.createElement('canvas');
canvas.width = 1000;
canvas.height = 800;
canvas.style.border = '1px solid #34495e';
canvas.style.borderRadius = '5px';
canvas.style.boxShadow = '0 0 10px rgba(0,0,0,0.1)';
canvasContainer.appendChild(canvas);
const ctx = canvas.getContext('2d');

// Sample data with classes and associated students
const classData = {
  'Testklasse': ['Alice', 'Bob', 'Charlie', 'David']
};

let selectedClass = Object.keys(classData)[0];
let currentStudents = classData[selectedClass];
let rows = 3;
let desksPerRow = [4, 4, 4];
let seatingArrangement = [];

// Constants
const VERTICAL_SPACING = 30; // Adjust this value to increase/decrease space between rows

// Add jsPDF library to the document
const jsPDFScript = document.createElement('script');
jsPDFScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
document.head.appendChild(jsPDFScript);

// Create file input for loading student data
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.txt,.csv';
fileInput.style.display = 'none';
sidebar.appendChild(fileInput);

// Create button for file input
const loadFileButton = document.createElement('button');
loadFileButton.textContent = 'Last inn elever fra en fil';
loadFileButton.style.backgroundColor = '#3498db';
loadFileButton.style.color = '#fff';
loadFileButton.style.border = 'none';
loadFileButton.style.padding = '10px';
loadFileButton.style.width = '100%';
loadFileButton.style.marginTop = '10px';
loadFileButton.style.cursor = 'pointer';
loadFileButton.style.borderRadius = '3px';
sidebar.appendChild(loadFileButton);

// Create class selector
const classSelector = document.createElement('select');
classSelector.style.width = '100%';
classSelector.style.padding = '5px';
classSelector.style.marginBottom = '10px';
classSelector.style.backgroundColor = '#34495e';
classSelector.style.color = '#ecf0f1';
classSelector.style.border = 'none';
classSelector.style.borderRadius = '3px';
Object.keys(classData).forEach(className => {
  const option = document.createElement('option');
  option.text = className;
  option.value = className;
  classSelector.appendChild(option);
});
sidebar.appendChild(classSelector);

// Create toggle button for student list
const toggleStudentList = document.createElement('button');
toggleStudentList.textContent = 'Skjul elever';
toggleStudentList.style.backgroundColor = '#3498db';
toggleStudentList.style.color = '#fff';
toggleStudentList.style.border = 'none';
toggleStudentList.style.padding = '10px';
toggleStudentList.style.width = '100%';
toggleStudentList.style.marginBottom = '10px';
toggleStudentList.style.cursor = 'pointer';
toggleStudentList.style.borderRadius = '3px';
sidebar.appendChild(toggleStudentList);

// Create student list container
const studentListContainer = document.createElement('div');
studentListContainer.style.marginBottom = '20px';
sidebar.appendChild(studentListContainer);

// Create student list
const studentList = document.createElement('ul');
studentList.id = 'studentList';
studentList.style.listStyle = 'none';
studentList.style.padding = '0';
studentListContainer.appendChild(studentList);

// Create container for row controls
const rowControlsContainer = document.createElement('div');
sidebar.appendChild(rowControlsContainer);

// Create desk tracker
const deskTracker = document.createElement('div');
deskTracker.id = 'deskTracker';
deskTracker.style.marginTop = '20px';
deskTracker.style.fontWeight = 'bold';
deskTracker.style.textAlign = 'center';
sidebar.appendChild(deskTracker);

// Create download button
const downloadButton = document.createElement('button');
downloadButton.textContent = 'Last ned PDF';
downloadButton.style.backgroundColor = '#2ecc71';
downloadButton.style.color = '#fff';
downloadButton.style.border = 'none';
downloadButton.style.padding = '10px';
downloadButton.style.width = '100%';
downloadButton.style.marginTop = '10px';
downloadButton.style.cursor = 'pointer';
downloadButton.style.borderRadius = '3px';
sidebar.appendChild(downloadButton);

// Create help button
const helpButton = document.createElement('button');
helpButton.textContent = 'Hjelp';
helpButton.style.backgroundColor = '#3498db';
helpButton.style.color = '#fff';
helpButton.style.border = 'none';
helpButton.style.padding = '10px';
helpButton.style.width = '100%';
helpButton.style.marginTop = '10px';
helpButton.style.cursor = 'pointer';
helpButton.style.borderRadius = '3px';
sidebar.appendChild(helpButton);

// Function to toggle student list visibility
function toggleStudentListVisibility() {
    if (studentListContainer.style.display === 'none') {
        studentListContainer.style.display = 'block';
        toggleStudentList.textContent = 'Skjul elever';
    } else {
        studentListContainer.style.display = 'none';
        toggleStudentList.textContent = 'Vis elever';
    }
}

// Function to check if a student is placed
function isStudentPlaced(studentName) {
  return seatingArrangement.some(desk => desk.student === studentName);
}

// Function to count student occurrences
function countStudentOccurrences(studentName) {
  return seatingArrangement.filter(desk => desk.student === studentName).length;
}

// Function to update student list
function updateStudentList() {
    const list = document.getElementById('studentList');
    list.innerHTML = '';
    currentStudents.forEach(student => {
        const li = document.createElement('li');
        li.textContent = student;
        li.style.padding = '5px';
        li.style.marginBottom = '5px';
        li.style.backgroundColor = '#34495e';
        li.style.borderRadius = '3px';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';

        if (isStudentPlaced(student)) {
            const indicator = document.createElement('span');
            indicator.textContent = '✓';
            indicator.style.color = countStudentOccurrences(student) > 1 ? '#e74c3c' : '#2ecc71';
            indicator.style.fontWeight = 'bold';
            li.appendChild(indicator);
            li.style.backgroundColor = '#2c3e50';  // Darker background for placed students
        }

        list.appendChild(li);
    });
}

// Function to handle file loading
function handleFileLoad(event) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const contents = e.target.result;
        const lines = contents.split('\n').map(line => line.trim()).filter(line => line);
        
        if (lines.length < 2) {
          alert('Fila må innekolde et klassenavn og minst én elev.');
          return;
        }
  
        const newClassName = lines[0];
        const students = lines.slice(1);
        
        // Check if the class name already exists
        if (classData[newClassName]) {
          alert('En klasse med dette navnet finnes allerede.');
          return;
        }
        
        // Add the new class to classData
        classData[newClassName] = students;
        
        // Add the new class to the selector
        const option = document.createElement('option');
        option.text = newClassName;
        option.value = newClassName;
        classSelector.appendChild(option);
        
        // Select the new class
        classSelector.value = newClassName;
        selectedClass = newClassName;
        currentStudents = students;
        
        updateStudentList();
        drawSeatingArrangement();
      };
      reader.readAsText(file);
    }
}

// Function to create row controls
function createRowControls() {
  rowControlsContainer.innerHTML = '';

  // Row count control
  const rowCountControl = document.createElement('div');
  rowCountControl.innerHTML = `
    <label>Rader: <span id="rowCount">${rows}</span></label>
    <div class="button-group">
      <button id="decreaseRows">-</button>
      <button id="increaseRows">+</button>
    </div>
  `;
  rowCountControl.style.marginBottom = '15px';
  rowCountControl.style.display = 'flex';
  rowCountControl.style.justifyContent = 'space-between';
  rowCountControl.style.alignItems = 'center';
  rowControlsContainer.appendChild(rowCountControl);

  // Add separator
  const separator = document.createElement('hr');
  separator.style.margin = '0 0 15px 0';
  separator.style.border = 'none';
  separator.style.borderTop = '1px solid #34495e';
  rowControlsContainer.appendChild(separator);

  // Individual row controls
  for (let i = 0; i < rows; i++) {
    const rowControlDiv = document.createElement('div');
    rowControlDiv.innerHTML = `
      <label>Rad ${i + 1} pulter: <span id="deskCount${i}">${desksPerRow[i]}</span></label>
      <div class="button-group">
        <button id="decreaseDesks${i}">-</button>
        <button id="increaseDesks${i}">+</button>
      </div>
    `;
    rowControlDiv.style.marginBottom = '10px';
    rowControlDiv.style.display = 'flex';
    rowControlDiv.style.justifyContent = 'space-between';
    rowControlDiv.style.alignItems = 'center';
    rowControlsContainer.appendChild(rowControlDiv);
  }

  // Style buttons
  const buttons = rowControlsContainer.querySelectorAll('button');
  buttons.forEach(button => {
    button.style.backgroundColor = '#3498db';
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.padding = '5px 10px';
    button.style.cursor = 'pointer';
    button.style.borderRadius = '3px';
    button.style.width = '30px';
  });

  // Add event listeners
  document.getElementById('decreaseRows').addEventListener('click', () => updateRows(-1));
  document.getElementById('increaseRows').addEventListener('click', () => updateRows(1));

  for (let i = 0; i < rows; i++) {
    document.getElementById(`decreaseDesks${i}`).addEventListener('click', () => updateDesksInRow(i, -1));
    document.getElementById(`increaseDesks${i}`).addEventListener('click', () => updateDesksInRow(i, 1));
  }
}

// Function to draw seating arrangement
function drawSeatingArrangement() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const deskWidth = 100;
  const deskHeight = 60;
  const spacing = 10;

  ctx.fillStyle = '#ecf0f1';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw title with student count
  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  const studentCount = currentStudents.length;
  ctx.fillText(`${selectedClass} - ${studentCount} elev${studentCount !== 1 ? 'er' : ''}`, canvas.width / 2, 30);

  // Draw board
  const boardHeight = 40;
  const boardY = 50;
  ctx.fillStyle = '#95a5a6';  // Gray color for the board
  ctx.fillRect(spacing, boardY, canvas.width - 2 * spacing, boardHeight);

  // Draw "TAVLE" text
  ctx.fillStyle = '#ffffff';  // White color for the text
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("TAVLE", canvas.width / 2, boardY + boardHeight / 2);

  let deskIndex = 0;
  for (let i = 0; i < rows; i++) {
    const rowWidth = desksPerRow[i] * (deskWidth + spacing) - spacing;
    const startX = (canvas.width - rowWidth) / 2;
    
    for (let j = 0; j < desksPerRow[i]; j++) {
      const x = startX + j * (deskWidth + spacing);
      const y = i * (deskHeight + VERTICAL_SPACING) + spacing + boardY + boardHeight + 20; // Adjusted for vertical spacing
      
      if (!seatingArrangement[deskIndex]) {
        seatingArrangement[deskIndex] = { x, y, width: deskWidth, height: deskHeight, student: null, removed: false };
      } else {
        seatingArrangement[deskIndex].x = x;
        seatingArrangement[deskIndex].y = y;
      }

      const desk = seatingArrangement[deskIndex];

      if (desk.removed) {
        ctx.fillStyle = '#ecf0f1';  // Background color
        ctx.fillRect(x, y, deskWidth, deskHeight);
        ctx.strokeStyle = '#ecf0f1';  // Make border same as background
      } else if (desk.student && countStudentOccurrences(desk.student) > 1) {
        ctx.fillStyle = '#e74c3c';  // Red color for duplicate placements
        ctx.fillRect(x, y, deskWidth, deskHeight);
        ctx.strokeStyle = '#c0392b';
      } else {
        ctx.fillStyle = '#3498db';  // Normal blue color
        ctx.fillRect(x, y, deskWidth, deskHeight);
        ctx.strokeStyle = '#2980b9';
      }

      ctx.strokeRect(x, y, deskWidth, deskHeight);

      if (desk.student && !desk.removed) {
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(desk.student, x + deskWidth / 2, y + deskHeight / 2);
      }

      deskIndex++;
    }
  }

  // Remove any extra desks if we've reduced the number of desks
  seatingArrangement = seatingArrangement.slice(0, deskIndex);

  // Update the student list to reflect any changes
  updateStudentList();
  
  // Update the desk tracker
  updateDeskTracker();
}

// Function to handle desk click
function handleDeskClick(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const clickedDesk = seatingArrangement.find(desk => 
    x >= desk.x && x <= desk.x + desk.width &&
    y >= desk.y && y <= desk.y + desk.height
  );

  if (clickedDesk) {
    const studentListContainer = document.createElement('div');
    studentListContainer.style.position = 'absolute';
    studentListContainer.style.left = `${clickedDesk.x + rect.left}px`;
    studentListContainer.style.top = `${clickedDesk.y + rect.top}px`;
    studentListContainer.style.backgroundColor = '#fff';
    studentListContainer.style.border = '1px solid #ccc';
    studentListContainer.style.borderRadius = '5px';
    studentListContainer.style.padding = '5px';
    studentListContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    studentListContainer.style.maxHeight = '200px';
    studentListContainer.style.overflowY = 'auto';

    const clearOption = document.createElement('div');
    clearOption.textContent = 'Tøm pult';
    clearOption.style.padding = '5px';
    clearOption.style.cursor = 'pointer';
    clearOption.addEventListener('click', () => {
      clickedDesk.student = null;
      clickedDesk.removed = false;
      drawSeatingArrangement();
      document.body.removeChild(studentListContainer);
    });
    studentListContainer.appendChild(clearOption);

    const removeOption = document.createElement('div');
    removeOption.textContent = clickedDesk.removed ? 'Vis pult' : 'Skjul pult';
    removeOption.style.padding = '5px';
    removeOption.style.cursor = 'pointer';
    removeOption.addEventListener('click', () => {
      clickedDesk.removed = !clickedDesk.removed;
      clickedDesk.student = null;
      drawSeatingArrangement();
      document.body.removeChild(studentListContainer);
    });
    studentListContainer.appendChild(removeOption);

    // Add separator
    const separator = document.createElement('hr');
    separator.style.margin = '5px 0';
    separator.style.border = 'none';
    separator.style.borderTop = '1px solid #ccc';
    studentListContainer.appendChild(separator);

    if (!clickedDesk.removed) {
      currentStudents.forEach(student => {
        const option = document.createElement('div');
        option.textContent = student;
        option.style.padding = '5px';
        option.style.cursor = 'pointer';
        
        if (isStudentPlaced(student)) {
          option.style.color = countStudentOccurrences(student) > 1 ? '#e74c3c' : '#2ecc71';
          option.style.fontWeight = 'bold';
        }

        option.addEventListener('click', () => {
          clickedDesk.student = student;
          clickedDesk.removed = false;
          drawSeatingArrangement();
          document.body.removeChild(studentListContainer);
        });
        studentListContainer.appendChild(option);
      });
    }

    document.body.appendChild(studentListContainer);

    // Close the list when clicking outside
    const closeList = (e) => {
      if (!studentListContainer.contains(e.target) && e.target !== canvas) {
        document.body.removeChild(studentListContainer);
        document.removeEventListener('click', closeList);
      }
    };
    
    requestAnimationFrame(() => {
      document.addEventListener('click', closeList);
    });

    event.stopPropagation();
  }
}

// Function to update rows
function updateRows(change) {
  rows = Math.max(1, rows + change);
  document.getElementById('rowCount').textContent = rows;
  
  if (change > 0) {
    for (let i = 0; i < change; i++) {
      desksPerRow.push(4);
    }
  } else {
    desksPerRow = desksPerRow.slice(0, rows);
  }
  
  createRowControls();
  drawSeatingArrangement();
  updateDeskTracker();
}

// Function to update desks in a specific row
function updateDesksInRow(rowIndex, change) {
  desksPerRow[rowIndex] = Math.max(1, desksPerRow[rowIndex] + change);
  document.getElementById(`deskCount${rowIndex}`).textContent = desksPerRow[rowIndex];
  drawSeatingArrangement();
  updateDeskTracker();
}

// Function to update desk tracker
function updateDeskTracker() {
  const totalDesks = desksPerRow.reduce((a, b) => a + b, 0);
  const visibleDesks = seatingArrangement.filter(desk => !desk.removed).length;
  deskTracker.textContent = `Totalt antall pulter: ${visibleDesks} / ${totalDesks}`;
}

// Function to download canvas as PDF
function downloadPDF() {
  // Ensure jsPDF is loaded
  if (typeof jspdf === 'undefined') {
    console.error('jsPDF library not loaded');
    return;
  }

  const { jsPDF } = jspdf;
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [canvas.width, canvas.height]
  });

  // Add the canvas as an image to the PDF
  const imgData = canvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);

  // Save the PDF
  pdf.save('klassekart.pdf');
}

// Function to show help guide
function showHelpGuide() {
    const helpModal = document.createElement('div');
    helpModal.style.position = 'fixed';
    helpModal.style.left = '0';
    helpModal.style.top = '0';
    helpModal.style.width = '100%';
    helpModal.style.height = '100%';
    helpModal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    helpModal.style.display = 'flex';
    helpModal.style.justifyContent = 'center';
    helpModal.style.alignItems = 'center';
  
    const helpContent = document.createElement('div');
    helpContent.style.backgroundColor = '#fff';
    helpContent.style.padding = '20px';
    helpContent.style.borderRadius = '5px';
    helpContent.style.maxWidth = '600px';
    helpContent.style.maxHeight = '80%';
    helpContent.style.overflowY = 'auto';
  
    const helpTitle = document.createElement('h2');
    helpTitle.textContent = 'Hvordan bruke applikasjonen';
    helpTitle.style.marginTop = '0';
  
    const helpText = document.createElement('ol');
    helpText.innerHTML = `
      <li>Velg en klasse fra nedtrekksmenyen øverst i sidepanelet.</li>
      <li>For å laste inn en ny klasse, klikk på "Last inn elever fra en fil" og velg en tekstfil med klassenavn på første linje og elevnavn på hver påfølgende linje.</li>
      <li>Juster antall rader ved å klikke på "+" eller "-" knappene ved siden av "Rader".</li>
      <li>Juster antall pulter i hver rad ved å klikke på "+" eller "-" knappene for hver rad.</li>
      <li>Klikk på en pult i klasserommet for å plassere en elev eller endre plassering.</li>
      <li>I menyen som dukker opp når du klikker på en pult, kan du:
        <ul>
          <li>Velge en elev for å plassere ved pulten</li>
          <li>Tømme pulten (fjerne eleven)</li>
          <li>Skjule eller vise pulten</li>
        </ul>
      </li>
      <li>Bruk "Skjul elever" / "Vis elever" knappen for å vise eller skjule elevlisten i sidepanelet.</li>
      <li>Se totalt antall pulter og synlige pulter nederst i sidepanelet.</li>
      <li>Når du er ferdig, klikk på "Last ned PDF" for å laste ned klasseromoppsettet som en PDF-fil.</li>
    `;
  
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Lukk';
    closeButton.style.backgroundColor = '#3498db';
    closeButton.style.color = '#fff';
    closeButton.style.border = 'none';
    closeButton.style.padding = '10px 20px';
    closeButton.style.marginTop = '20px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.borderRadius = '3px';
    closeButton.addEventListener('click', () => document.body.removeChild(helpModal));
  
    helpContent.appendChild(helpTitle);
    helpContent.appendChild(helpText);
    helpContent.appendChild(closeButton);
    helpModal.appendChild(helpContent);
    document.body.appendChild(helpModal);
  }

// Event listeners
canvas.addEventListener('click', handleDeskClick);
fileInput.addEventListener('change', handleFileLoad);
loadFileButton.addEventListener('click', () => fileInput.click());
toggleStudentList.addEventListener('click', toggleStudentListVisibility);
classSelector.addEventListener('change', (e) => {
  selectedClass = e.target.value;
  currentStudents = classData[selectedClass];
  updateStudentList();
  drawSeatingArrangement();
});
downloadButton.addEventListener('click', downloadPDF);
helpButton.addEventListener('click', showHelpGuide);

// Initial setup
createRowControls();
updateStudentList();
drawSeatingArrangement();
updateDeskTracker();