#!/usr/bin/env python3
"""
PDF to JSON Converter Tool

This script converts PDF files into JSON format, extracting text content from each page
and organizing it into a structured JSON document.

Features:
- Process individual PDF files or batch process multiple PDFs
- Extract text, word count, and character count for each page
- Create downloadable packages of the output JSON files
- Support for uploading PDFs through web interfaces or command line
"""

import http.server
import socketserver
import json
import io
import os
import base64
import tempfile
import zipfile
import cgi
import urllib.parse
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional, Union, Tuple, BinaryIO

# We'll use PyPDF2 for PDF processing
try:
    from PyPDF2 import PdfReader
except ImportError:
    print("PyPDF2 not found. Installing...")
    import subprocess
    subprocess.check_call(["pip", "install", "PyPDF2"])
    from PyPDF2 import PdfReader

# Port for the web server
PORT = 8000

class PDFConverterHandler(http.server.SimpleHTTPRequestHandler):
    """Custom handler for the PDF Converter web application."""
    
    def __init__(self, *args, **kwargs):
        # Set directory to the 'public' folder if it exists
        public_dir = Path(__file__).parent.parent
        if public_dir.exists():
            os.chdir(public_dir)
        super().__init__(*args, **kwargs)

    def do_GET(self):
        """Handle GET requests - serve static files."""
        # Redirect root to index.html
        if self.path == '/':
            self.path = '/index.html'
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        """Handle POST requests - process PDF files."""
        if self.path == '/convert':
            # Parse the form data
            content_type, pdict = cgi.parse_header(self.headers['Content-Type'])
            if content_type == 'multipart/form-data':
                form = cgi.FieldStorage(
                    fp=self.rfile, 
                    headers=self.headers,
                    environ={'REQUEST_METHOD': 'POST'}
                )
                
                results = []
                
                # Process each uploaded file
                if 'files[]' in form:
                    files = form['files[]']
                    if not isinstance(files, list):
                        files = [files]
                    
                    for fileitem in files:
                        if fileitem.filename:
                            # Get file content
                            file_data = fileitem.file.read()
                            
                            try:
                                # Process the PDF
                                result = self.process_pdf(file_data, fileitem.filename)
                                results.append(result)
                            except Exception as e:
                                results.append({
                                    'filename': fileitem.filename,
                                    'success': False,
                                    'error': str(e)
                                })
                
                # Send JSON response
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')  # CORS header
                self.end_headers()
                self.wfile.write(json.dumps(results).encode())
                return
                
            elif content_type == 'application/json':
                length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(length).decode('utf-8')
                payload = json.loads(post_data)
                
                # Handle specific JSON requests
                if 'action' in payload and payload['action'] == 'download_all':
                    json_data_list = payload.get('json_data', [])
                    zip_data = self.create_zip_package(json_data_list)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')  # CORS header
                    self.end_headers()
                    
                    response = {
                        'success': True,
                        'zip_base64': base64.b64encode(zip_data).decode('utf-8')
                    }
                    self.wfile.write(json.dumps(response).encode())
                    return
        
        # Handle CORS preflight requests
        elif self.path == '/convert' and self.command == 'OPTIONS':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()
            return
            
        # Default response for invalid requests
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b'Not Found')

    def process_pdf(self, file_data: bytes, filename: str) -> Dict[str, Any]:
        """
        Process PDF data and convert to JSON.
        
        Args:
            file_data: The raw PDF file data
            filename: The original filename
            
        Returns:
            Dictionary with the result data
        """
        # Create a temporary file to work with the PDF
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
            temp_pdf.write(file_data)
            temp_pdf_path = temp_pdf.name
        
        try:
            # Extract text from PDF
            pdf = PdfReader(temp_pdf_path)
            pages = []
            
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                pages.append({
                    "page_number": i + 1,
                    "content": text,
                    "word_count": len(text.split()) if text else 0,
                    "character_count": len(text) if text else 0
                })
            
            # Create JSON structure
            pdf_data = {
                "filename": filename,
                "total_pages": len(pages),
                "pages": pages
            }
            
            return {
                "filename": filename,
                "success": True,
                "data": pdf_data
            }
        
        except Exception as e:
            return {
                "filename": filename,
                "success": False,
                "error": str(e)
            }
        
        finally:
            # Clean up the temporary file
            try:
                os.unlink(temp_pdf_path)
            except:
                pass

    def create_zip_package(self, json_data_list: List[Dict[str, Any]]) -> bytes:
        """
        Create a ZIP file containing multiple JSON files.
        
        Args:
            json_data_list: List of JSON data objects
            
        Returns:
            Bytes containing the ZIP file data
        """
        # Create a BytesIO object to hold the ZIP file
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for item in json_data_list:
                if 'filename' in item and 'data' in item:
                    filename = item['filename'].replace('.pdf', '.json')
                    json_content = json.dumps(item['data'], indent=2)
                    zipf.writestr(filename, json_content)
        
        # Get the bytes from the BytesIO object
        zip_buffer.seek(0)
        return zip_buffer.read()


def extract_text_from_pdf(pdf_path: str) -> List[Dict[str, Any]]:
    """
    Extract text content from each page of a PDF file.
    
    Args:
        pdf_path: Path to the PDF file
        
    Returns:
        List of dictionaries, each containing page number and text content
    """
    try:
        pdf = PdfReader(pdf_path)
        pages = []
        
        for i, page in enumerate(pdf.pages):
            text = page.extract_text()
            pages.append({
                "page_number": i + 1,
                "content": text,
                "word_count": len(text.split()) if text else 0,
                "character_count": len(text) if text else 0
            })
            
        return pages
    except Exception as e:
        raise Exception(f"Error extracting text from PDF: {str(e)}")


def convert_pdf_to_json(pdf_path: str, output_path: Optional[str] = None) -> str:
    """
    Convert a PDF file to JSON format.
    
    Args:
        pdf_path: Path to the PDF file
        output_path: Optional path to save the JSON output
        
    Returns:
        Path to the saved JSON file
    """
    # Extract the base filename without extension
    base_name = os.path.basename(pdf_path)
    file_name = os.path.splitext(base_name)[0]
    
    # Generate default output path if not provided
