document.addEventListener('DOMContentLoaded', () => {

    const cards = document.querySelectorAll('.kanban-card');
    const columns = document.querySelectorAll('.tasks-container');
    
    // Función para actualizar el contador de tareas en cada columna
    const updateTaskCounts = () => {
        const allColumns = document.querySelectorAll('.kanban-column');
        allColumns.forEach(column => {
            const taskCount = column.querySelector('.task-count');
            const tasks = column.querySelectorAll('.kanban-card');
            taskCount.textContent = tasks.length;
        });
    };

    // Lógica de arrastrar y soltar para las tarjetas
    cards.forEach(card => {
        card.addEventListener('dragstart', () => {
            // Se añade una clase para dar estilo a la tarjeta que se arrastra
            card.classList.add('dragging');
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            updateTaskCounts(); // Actualiza contadores cuando se suelta la tarjeta
        });
    });

    columns.forEach(column => {
        column.addEventListener('dragover', e => {
            e.preventDefault(); // Necesario para permitir el 'drop'
            column.classList.add('drag-over');
            const draggingCard = document.querySelector('.dragging');
            // Opcional: Lógica para colocar un placeholder
            const afterElement = getDragAfterElement(column, e.clientY);
            if (afterElement == null) {
                column.appendChild(draggingCard);
            } else {
                column.insertBefore(draggingCard, afterElement);
            }
        });

        column.addEventListener('dragleave', () => {
            column.classList.remove('drag-over');
        });

        column.addEventListener('drop', e => {
            e.preventDefault();
            column.classList.remove('drag-over');
            // La lógica de append ya se hizo en 'dragover' para un feedback más fluido
        });
    });

    // Función para determinar la posición correcta de la tarjeta al arrastrar
    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.kanban-card:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    // Inicializar los contadores al cargar la página
    updateTaskCounts();

});