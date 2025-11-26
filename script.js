let inventoryList = [];
let html5QrCode;

// ⚠️ TU URL DE APPS SCRIPT
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzqeShO75VwdFhi2KmTxO2S8rmV6Adh4ETjBWBk4kQaDAO9Mwg5EbK_5YmUK243sCN1/exec";

document.addEventListener('DOMContentLoaded', () => {
    generateRandomCode();
    loadFromCloud();

    const scannerInput = document.getElementById('scannerInput');
    
    // Lógica del escáner (espera a que termine de escribir)
    let timeout = null;
    scannerInput.addEventListener('input', function() {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            const codigoBuscado = this.value.trim();
            if(codigoBuscado.length > 0) {
                searchAndDisplay(codigoBuscado);
            }
        }, 200); 
    });

    // --- 🛑 AQUÍ ESTABA EL CÓDIGO MOLESTO, YA LO QUITÉ ---

    document.getElementById('btnScanCamera').addEventListener('click', toggleCamera);
    setupFormListeners();
});

// --- NUEVA FUNCIÓN: CALCULAR DÍGITO VERIFICADOR EAN13 ---
function calculateEAN13Checksum(code) {
    if (code.length !== 12) return "";
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        let digit = parseInt(code[i]);
        if (i % 2 === 0) sum += digit * 1;
        else sum += digit * 3;
    }
    let remainder = sum % 10;
    let checkDigit = (10 - remainder) % 10;
    return code + checkDigit;
}

// --- GENERADOR ---
function generateRandomCode() {
    const type = document.getElementById('codeType').value;
    let code = "";
    if (type === "EAN13") {
        let base = "780" + Math.floor(Math.random() * 1000000000).toString().padStart(9, "0");
        code = calculateEAN13Checksum(base);
    } else {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    }
    document.getElementById('prodCode').value = code;
    renderBarcode(code);
}

// --- EL RESTO DEL CÓDIGO ---
function renderBarcode(value) {
    if(!value) return;
    try { 
        JsBarcode("#barcode", value, { 
            format: document.getElementById('codeType').value, 
            lineColor: "#000", width: 2, height: 40, displayValue: true, fontSize: 14, margin: 5,
            flat: true 
        }); 
    } catch (e) {}
}

function searchAndDisplay(code) {
    const resultBox = document.getElementById('scanResult');
    const foundItem = inventoryList.find(item => String(item["Código Escaneable"]) === String(code));

    if (foundItem) {
        document.getElementById('resPrice').innerText = "$" + foundItem["Precio"];
        document.getElementById('resPrice').className = "display-3 fw-bold text-success mb-0";
        document.getElementById('resName').innerText = foundItem["Nombre Producto"];
        document.getElementById('resStock').innerText = foundItem["Stock"];
        const units = foundItem["Unidades"] ? ` (${foundItem["Unidades"]} unid.)` : "";
        document.getElementById('resDesc').innerText = foundItem["Descripción"] + units;
        document.getElementById('resDesc').className = "badge bg-light text-dark fs-6";
        resultBox.style.display = 'block';
        playSound('success');
    } else {
        document.getElementById('resPrice').innerText = "NO REGISTRADO";
        document.getElementById('resPrice').className = "display-5 fw-bold text-danger mb-0";
        document.getElementById('resName').innerText = "Código desconocido";
        document.getElementById('resStock').innerText = "0";
        document.getElementById('resDesc').innerText = code;
        document.getElementById('resDesc').className = "badge bg-danger text-white fs-6";
        resultBox.style.display = 'block';
        playSound('error');
    }
    // Limpiar input después de un momento
    setTimeout(() => { document.getElementById('scannerInput').value = ''; }, 3000);
}

function playSound(type) {
    let audioSrc = 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'; 
    if (type === 'error') audioSrc = 'https://actions.google.com/sounds/v1/alarms/mechanical_clock_ring.ogg';
    new Audio(audioSrc).play().catch(e => console.log("Audio bloqueado"));
}

function loadFromCloud() {
    fetch(GOOGLE_SCRIPT_URL)
    .then(r => r.json())
    .then(data => {
        inventoryList = [];
        data.forEach(item => {
            inventoryList.push({
                "Código Escaneable": String(item.code), 
                "Nombre Producto": item.name, 
                "Precio": item.price,
                "Stock": item.stock, 
                "Descripción": item.desc, 
                "Unidades": item.units, 
                "Tipo Código": item.type
            });
        });
        updateTable();
        const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
        Toast.fire({ icon: 'success', title: 'Inventario Cargado' });
    });
}

function setupFormListeners() {
    const nameInput = document.getElementById('prodName');
    const descInput = document.getElementById('prodDesc');
    const unitsInput = document.getElementById('prodUnits');
    
    nameInput.addEventListener('input', function() { document.getElementById('preview-name').textContent = this.value || "Nombre"; });
    descInput.addEventListener('input', function() { document.getElementById('preview-desc').textContent = this.value || "Medidas"; });
    unitsInput.addEventListener('input', function() { document.getElementById('preview-units').textContent = this.value ? `(${this.value} u.)` : ""; });

    document.getElementById('prodCode').addEventListener('input', function() { renderBarcode(this.value); });
    document.getElementById('btnRandom').addEventListener('click', generateRandomCode);
    document.getElementById('productForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('btnDownload').addEventListener('click', downloadExcel);
}

function handleFormSubmit(e) {
    e.preventDefault();
    const code = String(document.getElementById('prodCode').value);
    const name = document.getElementById('prodName').value;
    const price = document.getElementById('prodPrice').value;
    const stock = document.getElementById('prodStock').value;
    const desc = document.getElementById('prodDesc').value;
    const units = document.getElementById('prodUnits').value;
    const type = document.getElementById('codeType').value;

    const dataToSend = { action: "create", code, name, price, stock, desc, units, type };
    Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });

    fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSend) })
    .then(() => {
        inventoryList.push({ "Código Escaneable": code, "Nombre Producto": name, "Precio": price, "Stock": stock, "Descripción": desc, "Unidades": units, "Tipo Código": type });
        updateTable();
        Swal.fire({ icon: 'success', title: 'Guardado', timer: 1000, showConfirmButton: false });
        e.target.reset(); generateRandomCode();
        document.getElementById('preview-name').innerText = "Nombre";
        document.getElementById('preview-desc').innerText = "Medidas";
        document.getElementById('preview-units').innerText = "";
    });
}

function updateTable() {
    const tbody = document.getElementById('inventoryTableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = "";
    
    if (inventoryList.length > 0) {
        if(emptyState) emptyState.style.display = 'none';
        
        [...inventoryList].reverse().forEach((item, index) => {
            const realIndex = inventoryList.length - 1 - index;
            
            const row = `
                <tr>
                    <td data-label="Producto">
                        ${item["Nombre Producto"]}
                        <div>${item["Código Escaneable"]}</div>
                    </td>
                    
                    <td data-label="Precio">
                        <div class="input-group input-group-sm">
                            <span class="input-group-text">$</span>
                            <input type="number" class="form-control" id="edit-price-${realIndex}" value="${item["Precio"]}">
                        </div>
                    </td>
                    
                    <td data-label="Stock">
                        <input type="number" class="form-control form-control-sm text-center" id="edit-stock-${realIndex}" value="${item["Stock"]}">
                    </td>
                    
                    <td data-label="Acciones">
                        <button class="btn btn-sm btn-info text-white" onclick="viewBarcode(${realIndex})"><i class="fa-solid fa-eye"></i></button>
                        <button class="btn btn-sm btn-primary" onclick="updateItemInCloud(${realIndex})"><i class="fa-solid fa-floppy-disk"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteItemInCloud(${realIndex})"><i class="fa-solid fa-trash"></i></button>
                        <button class="btn btn-sm btn-outline-dark" onclick="printSingleLabel('${item["Código Escaneable"]}', '${item["Nombre Producto"]}', '${item["Descripción"]}', '${item["Unidades"]}', '${item["Tipo Código"]}')"><i class="fa-solid fa-print"></i></button>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    } else {
        if(emptyState) emptyState.style.display = 'block';
    }
}

function toggleCamera() {
    const readerDiv = document.getElementById('reader');
    const btn = document.getElementById('btnScanCamera');
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            readerDiv.style.display = "none";
            btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
            btn.classList.remove('btn-danger'); btn.classList.add('btn-primary');
        });
        return;
    }
    readerDiv.style.display = "block";
    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    btn.classList.remove('btn-primary'); btn.classList.add('btn-danger');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } }, onScanSuccess);
}

function onScanSuccess(decodedText) {
    html5QrCode.stop().then(() => {
        document.getElementById('reader').style.display = "none";
        document.getElementById('btnScanCamera').innerHTML = '<i class="fa-solid fa-camera"></i>';
        document.getElementById('btnScanCamera').classList.remove('btn-danger');
        document.getElementById('btnScanCamera').classList.add('btn-primary');
    });
    document.getElementById('scannerInput').value = decodedText;
    searchAndDisplay(decodedText);
}

window.updateItemInCloud = function(index) {
    const item = inventoryList[index];
    const newPrice = document.getElementById(`edit-price-${index}`).value;
    const newStock = document.getElementById(`edit-stock-${index}`).value;
    const dataToSend = { action: "update", code: item["Código Escaneable"], price: newPrice, stock: newStock };
    Swal.fire({ title: 'Actualizando...', didOpen: () => Swal.showLoading() });
    fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSend) })
    .then(() => { inventoryList[index]["Precio"] = newPrice; inventoryList[index]["Stock"] = newStock; Swal.fire({ icon: 'success', title: '¡Actualizado!', timer: 1000, showConfirmButton: false }); });
};

window.deleteItemInCloud = function(index) {
    const item = inventoryList[index];
    Swal.fire({ title: '¿Borrar?', text: item["Nombre Producto"], icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Sí' }).then((r) => {
        if (r.isConfirmed) {
            Swal.fire({ title: 'Borrando...', didOpen: () => Swal.showLoading() });
            fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", code: item["Código Escaneable"] }) })
            .then(() => { inventoryList.splice(index, 1); updateTable(); Swal.fire('Borrado', '', 'success'); });
        }
    });
};

window.viewBarcode = function(index) {
    const item = inventoryList[index];
    document.getElementById('modalFullTitle').innerText = item["Nombre Producto"];
    document.getElementById('modalFullDesc').innerText = `${item["Descripción"]} ${item["Unidades"] ? '('+item["Unidades"]+' u.)' : ''}`;
    document.getElementById('modalProdPrice').innerText = "$" + item["Precio"];
    try { JsBarcode("#modalBarcodeSvg", item["Código Escaneable"], { format: item["Tipo Código"], lineColor: "#000", width: 3, height: 80, displayValue: true, fontSize: 18 }); } catch (e) {}
    new bootstrap.Modal(document.getElementById('viewBarcodeModal')).show();
};

window.printSingleLabel = function(code, name, desc, units, type) {
    const unitsText = units ? `(${units} unid.)` : ""; 
    const w = window.open('', '', 'width=500,height=400');
    w.document.write(`<html><head><style>body{font-family:Arial;display:flex;justify-content:center;padding-top:20px}.c{width:300px;text-align:center}.n{font-size:24px;font-weight:bold;margin-bottom:5px;text-transform:lowercase}.i{font-size:18px;font-weight:bold;margin-bottom:10px}svg{width:100%}</style></head><body><div class="c"><div class="n">${name}</div><div class="i">${desc} ${unitsText}</div><svg id="b"></svg></div><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script><script>JsBarcode("#b","${code}",{format:"${type||"EAN13"}",width:2.5,height:70,displayValue:true,fontSize:18,fontOptions:"bold",margin:0});window.onload=function(){setTimeout(function(){window.print();window.close()},500)}<\/script></body></html>`);
    w.document.close();
};

function downloadExcel() {
    if(inventoryList.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(inventoryList);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, "Base_Datos_Tienda.xlsx");
}
