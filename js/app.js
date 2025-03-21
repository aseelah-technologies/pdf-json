// DOM elements
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const convertBtn = document.getElementById('convertBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const resultContainer = document.getElementById('resultContainer');
const resultList = document.getElementById('resultList');

// Store uploaded files
let uploadedFiles = [];
let processedResults = [];

// Server endpoint - change this when deploying
const serverEndpoint = location.protocol === 'https:' 
    ? 'https://your-custom-api-endpoint.com/convert' 
    : '/convert';

// ---- FILE HANDLING FUNCTIONS ----

// Drag and drop handling
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, unhighlight, false);
});

function highlight() {
    dropArea.classList.add('dragover');
}

function unhighlight() {
    dropArea.classList.remove('dragover');
}

// Handle file drop
dropArea.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

// Handle file selection via click
dropArea.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
});

// Process the files
function handleFiles(files) {
    if (files.length === 0) return;
    
    // Filter for PDFs only
    const pdfFiles = Array.from(files).filter(file => 
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );
    
    // Add to uploaded files array
    uploadedFiles = [...uploadedFiles, ...pdfFiles];
    
    // Update the UI
    updateFileList();
    
    // Enable convert button if we have files
    convertBtn.disabled = uploadedFiles.length === 0;
}

// Update file list in UI
function updateFileList() {
    fileList.innerHTML = '';
    
    uploadedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = file.name;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'file-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', () => {
            uploadedFiles.splice(index, 1);
            updateFileList();
            convertBtn.disabled = uploadedFiles.length === 0;
        });
        
        fileItem.appendChild(fileName);
        fileItem.appendChild(removeBtn);
        fileList.appendChild(fileItem);
    });
}

// ---- CONVERSION FUNCTIONS ----

// Convert button click handler
convertBtn.addEventListener('click', async () => {
    if (uploadedFiles.length === 0) return;
    
    // Show progress UI
    progressContainer.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    convertBtn.disabled = true;
    
    // Reset results
    resultList.innerHTML = '';
    processedResults = [];
    
    // Process files
    await processFiles();
});

// Process all files
async function processFiles() {
    progressBar.max = uploadedFiles.length;
    progressBar.value = 0;
    
    const results = [];
    
    for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        statusText.textContent = `Processing ${file.name} (${i+1}/${uploadedFiles.length})...`;
        
        try {
            // Try server-side processing first
            let result;
            
            try {
                // Check if we can connect to the server
                const serverCheckResponse = await fetch(serverEndpoint, { 
                    method: 'HEAD',
                    mode: 'no-cors'
                }).catch(() => null);
                
                if (serverCheckResponse) {
                    // Use server-side processing
                    result = await processWithServer(file);
                } else {
                    // Fall back to client-side processing
                    result = await processWithPdfJs(file);
                }
            } catch (serverError) {
                console.warn('Server processing failed, falling back to client-side:', serverError);
                result = await processWithPdfJs(file);
            }
            
            results.push(result);
        } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
            results.push({
                filename: file.name,
                success: false,
                error: error.message || 'Unknown error occurred'
            });
        }
        
        progressBar.value = i + 1;
    }
    
    processedResults = results;
    
    // Display results
    displayResults(results);
    
    // Update UI
    statusText.textContent = 'Processing complete!';
    resultContainer.classList.remove('hidden');
}

// Process PDF with server
async function processWithServer(file) {
    const formData = new FormData();
    formData.append('files[]', file);
    
    const response = await fetch(serverEndpoint, {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }
    
    const results = await response.json();
    return results[0]; // We're sending one file, so get the first result
}

// Process PDF with PDF.js (client-side)
async function processWithPdfJs(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
        
        const numPages = pdf.numPages;
        const pages = [];
        
        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            
            pages.push({
                page_number: i,
                content: pageText,
                word_count: pageText.split(/\s+/).filter(Boolean).length,
                character_count: pageText.length
            });
        }
        
        return {
            filename: file.name,
            success: true,
            data: {
                filename: file.name,
                total_pages: numPages,
                pages: pages
            }
        };
    } catch (error) {
        console.error('Error processing PDF:', error);
        throw error;
    }
}

// ---- DISPLAY FUNCTIONS ----

// Display the processing results
function displayResults(results) {
    resultList.innerHTML = '';
    
    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'container';
        
        const header = document.createElement('h3');
        header.textContent = result.filename;
        resultItem.appendChild(header);
        
        if (!result.success || result.error) {
            // Error occurred
            const errorText = document.createElement('div');
            errorText.className = 'status';
            errorText.style.color = 'red';
            errorText.textContent = `Error: ${result.error || 'Processing failed'}`;
            resultItem.appendChild(errorText);
        } else {
            // Success
            const previewHeader = document.createElement('h4');
            previewHeader.textContent = 'JSON Preview:';
            resultItem.appendChild(previewHeader);
            
            const jsonPreview = document.createElement('div');
            jsonPreview.className = 'json-preview';
            jsonPreview.textContent = JSON.stringify(result.data, null, 2);
            resultItem.appendChild(jsonPreview);
            
            // Download button
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'download-btn';
            downloadBtn.textContent = 'Download JSON';
            downloadBtn.addEventListener('click', () => {
                // Create a Blob from the JSON data
                const jsonBlob = new Blob(
                    [JSON.stringify(result.data, null, 2)], 
                    {type: 'application/json'}
                );
                
                // Create a download link
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(jsonBlob);
                downloadLink.download = result.filename.replace('.pdf', '.json');
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            });
            resultItem.appendChild(downloadBtn);
        }
        
        resultList.appendChild(resultItem);
    });
    
    // Create download all button if multiple successful conversions
    const successfulResults = results.filter(r => r.success && !r.error);
    if (successfulResults.length > 1) {
        const downloadAllContainer = document.createElement('div');
        downloadAllContainer.style.marginTop = '20px';
        downloadAllContainer.style.textAlign = 'center';
        
        const downloadAllBtn = document.createElement('button');
        downloadAllBtn.className = 'download-btn';
        downloadAllBtn.textContent = 'Download All as ZIP';
        downloadAllBtn.addEventListener('click', downloadAllAsZip);
        
        downloadAllContainer.appendChild(downloadAllBtn);
        resultList.appendChild(downloadAllContainer);
    }
}

// Download all files as a ZIP package
async function downloadAllAsZip() {
    const successfulResults = processedResults.filter(r => r.success && !r.error);
    
    if (successfulResults.length === 0) return;
    
    try {
        // First try to use the server for creating ZIP
        try {
            const response = await fetch(serverEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'download_all',
                    json_data: successfulResults.map(result => ({
                        filename: result.filename,
                        data: result.data
                    }))
                })
            });
            
            if (!response.ok) {
                throw new Error('Server ZIP creation failed');
            }
            
            const responseData = await response.json();
            
            if (responseData.success && responseData.zip_base64) {
                // Create a download from the base64 data
                const binaryString = atob(responseData.zip_base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                const blob = new Blob([bytes], { type: 'application/zip' });
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(blob);
                downloadLink.download = 'pdf_to_json_output.zip';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                return;
            }
        } catch (error) {
            console.warn('Server ZIP creation failed, using client-side ZIP:', error);
        }
        
        // Fall back to client-side ZIP creation
        const zip = new JSZip();
        
        // Add each JSON to the ZIP
        successfulResults.forEach(result => {
            const filename = result.filename.replace('.pdf', '.json');
            const content = JSON.stringify(result.data, null, 2);
            zip.file(filename, content);
        });
        
        // Generate the ZIP file
        const zipBlob = await zip.generateAsync({type: 'blob'});
        
        // Create a download link
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = 'pdf_to_json_output.zip';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
    } catch (error) {
        console.error('Error creating ZIP package:', error);
        alert(`Error creating ZIP package: ${error.message}`);
    }
}
